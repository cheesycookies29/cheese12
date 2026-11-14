// Project Management routes: projects with members, milestones (contract deliverables), tasks on
// a board, comments and time logs. Who sees a project: the people on its member list (manager,
// member or viewer), whatever their account type, and administrators (projectAccess in
// shared/projects.js). Everyone else gets "not found", for the project and for everything in it.
// Data lives in db.data.pm* collections; the Projects setup (default statuses, project types, the
// wording of the effort sizes and the code counter) in db.data.pm. A project marked as a template
// (isTemplate) is left out of the portfolio, My work and health; "+ New project" can
// start from it.
// Tasks have watchers (who hears of comments and of the task being done or cancelled), files
// (tasks and milestones, through server/attachments.js) and can be changed in bulk or imported from
// a CSV file. A daily digest goes by email through the Service Desk's outgoing mail, when set up.
// Effort is a task's size (XS to XL). Hours are only kept on projects that track time
// (timeTracking, off unless a manager turns it on): the Time tab, logging on tasks, the budget and
// the weekly Timesheet, which is separate from attendance (the DTR is only shown next to it).
import { randomUUID } from 'node:crypto';
import { HttpError, localDate, localTime } from './util.js';
import { noAudit } from './audit.js';
import { parseUpload } from './attachments.js';
import { imageIdsOf } from '../shared/richtext.js';
import { sendMail as smtpSend } from './mail/smtp.js';
import { composeMessage, newMessageId } from './mail/compose.js';
import { digestEmail } from './pm-digest.js';
import { parseCsv } from '../shared/csv.js';
import { can, userCan } from '../shared/roles.js';
import { isDate } from './crm.js';
import { computeEntry, scheduleFor } from '../shared/calc.js';
import { TICKET_STATUS, UNRESOLVED_TICKET } from '../shared/helpdesk.js';
import {
  PROJECT_STATUS, OPEN_PROJECT, CATEGORIES, PRIORITY, MEMBER_ROLES, HEALTH, STATUS_COLORS, DEFAULT_STATUSES, DEFAULT_TYPES,
  workCalendar, statusOf, categoryOf, isOpenCategory, firstStatus, statusSetProblem, taskFlags, milestoneOfTask, leafTasks,
  projectStatus, placeInColumn, byRank, makesCycle, myWorkGroup, daysBetween, addDays,
  validHours, RANK_STEP, weekStart, shiftWorkDays, mentionedUsernames, cleanViewQuery, VIEW_TABS, MAX_DAY_HOURS,
  isSize, sizeName, sizeWeight, sizeFromHours, cleanSizeNotes, DEFAULT_SIZE_NOTES, SIZE_KEYS,
  NOTIFY_KEEP, NOTIFY_DAYS, milestoneBurnup, addWorkDays, DIGEST_DEFAULTS, validDigestTime, digestDue, digestFor, billingAmount, billingForecast,
  IMPORT_FIELDS, IMPORT_MAX_ROWS, IMPORT_MAX_BYTES, guessImportMapping, importPlan, parseProjectIcon, projectAccess,
} from '../shared/projects.js';
export { projectAccess };
import { addStarterTemplates } from './pm-templates.js';

// Every collection here has a projectId, so deleting a project (or the demo data) takes its records.
// pmNotifications: "For you" on My work, one row per person and event. pmViews: saved filters of a
// project's Board or List, a person's own (userId) or shared with the project (userId null).
export const PM_COLLECTIONS = ['pmProjects', 'pmMilestones', 'pmTasks', 'pmComments', 'pmTimeLogs', 'pmNotifications', 'pmViews'];
// digest: the company's daily digest (Projects setup), the address links in it open (origin, from
// where the setup was saved) and, per person, the last day one was sent (sent: { userId: date }).
export const emptyDigest = () => ({ ...DIGEST_DEFAULTS, origin: null, sent: {}, lastRun: null });
// sizes: the company's wording of what each effort size means (the weights never change).
export const emptyPm = () => ({ statuses: structuredClone(DEFAULT_STATUSES), types: [...DEFAULT_TYPES], sizes: { ...DEFAULT_SIZE_NOTES }, seq: { project: 0 }, digest: emptyDigest() });

// The Projects setup survives demo data and "erase all data", like the sales setup: a setup
// someone saved (`customized`) comes with a backup; otherwise the current one is kept, with the
// code counter of the incoming data.
// Whether the starter templates were made goes with the projects, like the counter: a backup brings
// its own, and erased data (or a backup from before templates) gets them again.
export function keepPmConfig(current, next) {
  const seq = (s) => ({ project: Number.isInteger(s?.project) && s.project >= 0 ? s.project : 0 });
  const seeded = next?.templatesSeeded === true ? { templatesSeeded: true } : {};
  if (next?.customized) return { ...emptyPm(), ...next, seq: seq(next.seq) };
  const { templatesSeeded, ...setup } = current || {};
  return { ...emptyPm(), ...setup, seq: seq(next?.seq), ...seeded };
}

// Notifications older than 60 days go, and each person keeps their newest 200.
export function pruneNotifications(list, nowMs = Date.now(), userId = null) {
  const cutoff = new Date(nowMs - NOTIFY_DAYS * 86400000).toISOString();
  const kept = list.filter((n) => n.at >= cutoff);
  const per = new Map();
  for (const n of kept) if (!userId || n.userId === userId) per.set(n.userId, (per.get(n.userId) || 0) + 1);
  const over = new Map([...per].filter(([, c]) => c > NOTIFY_KEEP).map(([id, c]) => [id, c - NOTIFY_KEEP]));
  if (!over.size) return kept.length === list.length ? list : kept;
  // The oldest of those over the cap go.
  const drop = new Set();
  for (const [id, n] of over) kept.filter((x) => x.userId === id).sort((a, b) => a.at.localeCompare(b.at)).slice(0, n).forEach((x) => drop.add(x));
  return kept.filter((x) => !drop.has(x));
}

export function migratePm(db) {
  let changed = false;
  for (const k of PM_COLLECTIONS) if (!Array.isArray(db.data[k])) (db.data[k] = []), (changed = true);
  const pm = db.data.pm;
  if (!pm || typeof pm !== 'object' || Array.isArray(pm)) (db.data.pm = emptyPm()), (changed = true);
  else {
    // A setup of the wrong shape (a hand-edited backup) falls back to the defaults, key by key.
    if (!Array.isArray(pm.statuses) || statusSetProblem(pm.statuses)) (pm.statuses = structuredClone(DEFAULT_STATUSES)), (changed = true);
    if (!Array.isArray(pm.types) || !pm.types.length) (pm.types = [...DEFAULT_TYPES]), (changed = true);
    if (!cleanSizeNotes(pm.sizes).notes) (pm.sizes = { ...DEFAULT_SIZE_NOTES }), (changed = true);
    if (!pm.seq || typeof pm.seq !== 'object' || !Number.isInteger(pm.seq.project) || pm.seq.project < 0) (pm.seq = { project: 0 }), (changed = true);
    const g = pm.digest;
    if (!g || typeof g !== 'object' || Array.isArray(g)) (pm.digest = emptyDigest()), (changed = true);
    else {
      if (typeof g.enabled !== 'boolean') (g.enabled = false), (changed = true);
      if (!validDigestTime(g.time)) (g.time = DIGEST_DEFAULTS.time), (changed = true);
      if (typeof g.workingDaysOnly !== 'boolean') (g.workingDaysOnly = true), (changed = true);
      if (!g.sent || typeof g.sent !== 'object' || Array.isArray(g.sent)) (g.sent = {}), (changed = true);
      if (g.origin != null && (typeof g.origin !== 'string' || !/^https?:\/\/[^\s/]+$/.test(g.origin))) (g.origin = null), (changed = true);
    }
  }
  // The code counter never falls behind the codes in use (e.g. after restoring an older backup).
  const top = db.data.pmProjects.reduce((n, p) => Math.max(n, Number(String(p.code || '').match(/^PRJ-(\d+)$/)?.[1] || 0)), 0);
  if (top > db.data.pm.seq.project) (db.data.pm.seq.project = top), (changed = true);
  const pruned = pruneNotifications(db.data.pmNotifications);
  if (pruned !== db.data.pmNotifications) (db.data.pmNotifications = pruned), (changed = true);
  // The starter templates, once per database (unless it already has templates of its own).
  if (!db.data.pm.templatesSeeded) {
    if (!db.data.pmProjects.some((p) => p.isTemplate)) addStarterTemplates(db.data);
    db.data.pm.templatesSeeded = true;
    changed = true;
  }
  // Watchers (0.15): tasks from before watch the person who added them and their assignee.
  for (const t of db.data.pmTasks) {
    if (Array.isArray(t.watchers)) continue;
    t.watchers = [...new Set([t.createdBy, t.assigneeId].filter((x) => typeof x === 'string'))];
    changed = true;
  }
  if (migrateEffort(db.data)) changed = true;
  return changed;
}

// Sizes instead of hours (0.17), once: each task's (and template task's) hour estimate becomes a
// size (sizeFromHours), noted in its history; estimates and hours left go. A project with time
// logged on it tracks time from now on, so its history stays visible, and keeps its budget; the
// others do not track time. Saved List views that sorted by the estimate sort by size, and those
// that sorted by the hours left lose that sort. Running it again changes nothing.
export function migrateEffort(data) {
  let changed = false;
  const at = new Date().toISOString();
  for (const t of data.pmTasks) {
    if (Object.hasOwn(t, 'estimateHours') || Object.hasOwn(t, 'remainingHours')) {
      if (!isSize(t.size)) {
        t.size = sizeFromHours(t.estimateHours);
        if (t.size) {
          (t.history ||= []).push({ at, by: null, field: 'size from the hour estimate', from: `${Number(t.estimateHours)} h`, to: sizeName(t.size) });
          if (t.history.length > MAX_HISTORY) t.history.splice(0, t.history.length - MAX_HISTORY);
        }
      }
      delete t.estimateHours;
      delete t.remainingHours;
      changed = true;
    }
    if (t.size !== null && !isSize(t.size)) (t.size = null), (changed = true);
  }
  const logged = new Set(data.pmTimeLogs.map((x) => x.projectId));
  for (const p of data.pmProjects) {
    if (typeof p.timeTracking !== 'boolean') {
      p.timeTracking = !p.isTemplate && logged.has(p.id);
      if (p.timeTracking) (p.history ||= []).push({ at, by: null, field: 'time tracking', from: '', to: 'On: it has logged time' });
      changed = true;
    }
    if (!p.timeTracking && p.budgetHours != null) (p.budgetHours = null), (changed = true);
  }
  for (const v of data.pmViews) {
    const q = cleanViewQuery(v.tab, v.query);
    if (q !== v.query) (v.query = q), (changed = true);
  }
  return changed;
}

// The weekly Timesheet: for anyone who works (member or manager) on a project that tracks time,
// and for those who manage one (they see their members' timesheets). Shown in the browser's menu.
export function timesheetAccess(db, user) {
  if (!user) return false;
  const tracked = (db.data.pmProjects || []).filter((p) => p.timeTracking && !p.isTemplate);
  return tracked.some((p) => p.members.some((m) => m.userId === user.id && m.role !== 'viewer')) || (userCan(user, 'pm.edit') && tracked.length > 0);
}

// Is this account a member of any project? (The Projects module opens for members.)
export const isProjectMember = (db, user) => Boolean(user) && (db.data.pmProjects || []).some((p) => p.members.some((m) => m.userId === user.id));

// A deleted account: off every project, its tasks unassigned, the project's manager field cleared.
// Their notifications and private saved views go; shared views and others' notifications stay.
export function removeUserFromProjects(db, userId) {
  for (const p of db.data.pmProjects || []) {
    p.members = p.members.filter((m) => m.userId !== userId);
    if (p.managerId === userId) p.managerId = null;
  }
  for (const t of db.data.pmTasks || []) {
    if (t.assigneeId === userId) t.assigneeId = null;
    if (t.watchers?.includes(userId)) t.watchers = t.watchers.filter((x) => x !== userId);
    if (t.unwatchedBy?.includes(userId)) t.unwatchedBy = t.unwatchedBy.filter((x) => x !== userId);
  }
  db.data.pmNotifications = (db.data.pmNotifications || []).filter((n) => n.userId !== userId);
  for (const n of db.data.pmNotifications) if (n.actorId === userId) n.actorId = null;
  db.data.pmViews = (db.data.pmViews || []).filter((v) => v.userId !== userId);
}

// The project tasks linked to a service desk ticket (shown on the ticket).
// user: who is looking. A task in a project they are not on shows only that it exists.
export function linkedTasks(db, ticketId, user = null) {
  return (db.data.pmTasks || []).filter((t) => t.ticketId === ticketId).map((t) => {
    const p = db.data.pmProjects.find((x) => x.id === t.projectId);
    if (!p || !projectAccess(p, user)) return { id: null, key: '', title: 'A task in a project you are not on', projectId: null, projectCode: '', projectName: '', statusName: '', category: 'todo', hidden: true };
    const s = p && statusOf(p, t.statusId);
    return { id: t.id, key: t.key, title: t.title, projectId: t.projectId, projectCode: p?.code || '', projectName: p?.name || '', statusName: s?.name || '', category: s?.category || 'todo' };
  });
}

// ----- Input checks -----
// Only text and numbers become text: an array or object sent as a field is treated as empty.
const str = (v, max = 200) => (v == null || typeof v === 'object' ? '' : String(v)).trim().slice(0, max);
const now = () => new Date().toISOString();
const optDate = (v, label) => {
  if (v == null || v === '') return null;
  if (!isDate(v)) throw new HttpError(400, `${label} must be a date.`);
  return v;
};
function oneOf(v, options, label, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string' || !Object.hasOwn(options, v)) throw new HttpError(400, `${label}: pick one of the options.`);
  return v;
}
// A number from a form: a number, or text of digits. No hex, exponents or Infinity.
function optNum(v, label, min, max) {
  if (v == null || (typeof v === 'string' && !v.trim())) return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} must be a number from ${min} to ${max}.`);
  return Math.round(n * 100) / 100;
}
const bool = (v, label, fallback = false) => {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') throw new HttpError(400, `${label} must be true or false.`);
  return v;
};
const idOf = (v) => (typeof v === 'string' && v.length <= 64 ? v : '');
// Only the fields a form may change: anything else in the body is ignored.
const pickFields = (body, keys) => Object.fromEntries(keys.filter((k) => body && typeof body === 'object' && Object.hasOwn(body, k)).map((k) => [k, body[k]]));

const PROJECT_FIELDS = ['name', 'type', 'description', 'status', 'startDate', 'endDate', 'managerId', 'timeTracking', 'budgetHours', 'accountId', 'dealId', 'contractId', 'icon'];

const TASK_FIELDS = ['title', 'description', 'statusId', 'priority', 'assigneeId', 'startDate', 'dueDate', 'size', 'milestoneId', 'parentId', 'blockedBy'];
const MILESTONE_FIELDS = ['name', 'dueDate', 'deliverable', 'billingPercent', 'submittedAt', 'acceptedAt', 'acceptanceNote'];
const LEVEL = { read: 1, comment: 2, work: 3, manage: 4 };
const MAX_HISTORY = 200;

// The files of tasks and milestones of a project (to remove with it).
export const projectFiles = (data, projectId) => [
  ...(data.pmTasks || []), ...(data.pmMilestones || []),
].filter((x) => x.projectId === projectId).flatMap((x) => [...(x.attachments || []), ...(x.images || [])]).concat((data.pmProjects || []).filter((p) => p.id === projectId && p.iconImage?.id).map((p) => p.iconImage));

const IMAGE_GRACE_MS = 2 * 3600 * 1000; // a picture not (yet) in the description is kept this long: someone may be writing
const BULK_MAX = 200; // tasks per bulk change
const BULK_FIELDS = ['statusId', 'assigneeId', 'milestoneId', 'priority', 'size'];
const TIMESHEET_MAX_CELLS = 500; // per save

// files: server/attachments.js; mailer: the Service Desk's outgoing mail (canEmail, smtpOptions,
// address). sendMail and clock can be replaced by tests.
export function registerProjectRoutes(route, db, { audit, files, mailer, sendMail = smtpSend, clock = () => new Date() } = {}) {
  const d = () => db.data;
  const pm = () => db.data.pm;
  const user = (id) => d().users.find((u) => u.id === id);
  const userName = (id) => user(id)?.name || null;
  const activeUser = (id) => d().users.find((u) => u.id === id && u.active);
  const cal = () => workCalendar(d().settings, d().holidays);
  const today = () => localDate();

  // ----- Who may do what in a project -----
  // manage: the project's managers (and administrators); work: a member; comment: a viewer.
  const levelOf = projectAccess;
  // A project is for its members: a change must not shut out the person making it (administrators
  // open every project anyway).
  const SELF_OFF = 'A project is open to its members only: keep yourself on the member list (or as its manager), or you would lose access to it.';
  const DENIED = {
    manage: 'Only the project\'s managers can change this.',
    work: 'You can read and comment on this project, but not change its tasks.',
    comment: 'You can read this project, but not comment on it.',
  };
  function need(p, u, level) {
    const has = levelOf(p, u);
    if (!has) throw new HttpError(404, 'Project not found.');
    if (LEVEL[has] < LEVEL[level]) throw new HttpError(403, DENIED[level]);
    return has;
  }
  function findProject(id, u, level = 'read') {
    const p = d().pmProjects.find((x) => x.id === id);
    if (!p || !levelOf(p, u)) throw new HttpError(404, 'Project not found.');
    need(p, u, level);
    return p;
  }
  // A task, its project and the access to it: not found for anyone who cannot see the project.
  function findTask(id, u, level = 'read') {
    const t = d().pmTasks.find((x) => x.id === id);
    const p = t && d().pmProjects.find((x) => x.id === t.projectId);
    if (!t || !p || !levelOf(p, u)) throw new HttpError(404, 'Task not found.');
    need(p, u, level);
    return { t, p };
  }
  // The projects a person sees in lists (templates apart).
  const visibleProjects = (u) => d().pmProjects.filter((p) => !p.isTemplate && levelOf(p, u));
  const visibleTemplates = (u) => d().pmProjects.filter((p) => p.isTemplate && levelOf(p, u));

  // Stale edits: the form sends the version it loaded; if the record changed since, refuse.
  function fresh(rec, body) {
    if (body && body.version !== undefined && body.version !== null && body.version !== rec.version) {
      throw new HttpError(409, `This record was changed by ${userName(rec.updatedBy) || 'someone else'} since you opened it. Close the form, reload, and make your change again.`);
    }
  }
  const bump = (rec, u) => Object.assign(rec, { version: (rec.version || 0) + 1, updatedAt: now(), updatedBy: u.id });
  const track = (rec, u, field, from, to) => {
    if ((from ?? '') === (to ?? '')) return;
    rec.history ||= [];
    rec.history.push({ at: now(), by: u.id, field, from: from ?? '', to: to ?? '' });
    if (rec.history.length > MAX_HISTORY) rec.history.splice(0, rec.history.length - MAX_HISTORY);
  };

  // ----- Shapes sent to the browser -----
  const accountName = (id) => d().crmAccounts.find((a) => a.id === id)?.name || null;
  const crmRef = (coll, id) => {
    const r = id && d()[coll].find((x) => x.id === id);
    return r ? { id: r.id, code: r.code, title: r.title, ...(r.endDate !== undefined ? { endDate: r.endDate, status: r.status } : {}), ...(r.stage ? { stage: r.stage } : {}) } : null;
  };
  const membersOut = (p) => p.members.map((m) => {
    const x = user(m.userId);
    return { userId: m.userId, role: m.role, name: x?.name || 'Former user', username: x?.username || '', active: Boolean(x?.active) };
  });
  const tasksOf = (p) => d().pmTasks.filter((t) => t.projectId === p.id);
  const milestonesOf = (p) => d().pmMilestones.filter((m) => m.projectId === p.id).sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9') || (a.order || 0) - (b.order || 0));
  function summaryOf(p, u, c = cal()) {
    const tasks = tasksOf(p);
    const milestones = milestonesOf(p);
    const s = projectStatus(p, milestones, tasks, today(), c);
    const next = milestones.find((m) => !m.acceptedAt && s.milestones.find((x) => x.id === m.id && !x.finished));
    const { history, ...rest } = p;
    // A template is a pattern, not work: no health.
    return {
      ...rest, isTemplate: Boolean(p.isTemplate), timeTracking: Boolean(p.timeTracking), budgetHours: p.timeTracking ? p.budgetHours ?? null : null, access: levelOf(p, u), managerName: userName(p.managerId), accountName: accountName(p.accountId),
      health: p.isTemplate ? null : s.value, healthReasons: p.isTemplate ? [] : s.reasons, progress: s.progress, openTasks: s.openTasks, overdueTasks: s.overdueTasks, blockedTasks: s.blockedTasks,
      myOpenTasks: tasks.filter((t) => t.assigneeId === u.id && isOpenCategory(categoryOf(p, t))).length,
      nextMilestone: next ? { id: next.id, name: next.name, dueDate: next.dueDate, deliverable: next.deliverable } : null,
      members: membersOut(p),
    };
  }
  function taskOut(t, p, ctx) {
    const s = statusOf(p, t.statusId);
    const flags = taskFlags(t, p, ctx.byId, ctx.today, ctx.cal);
    const ticket = t.ticketId && d().tickets.find((x) => x.id === t.ticketId);
    const { history, unwatchedBy, ...rest } = t;
    return {
      ...rest, size: isSize(t.size) ? t.size : null, statusName: s?.name || '', category: flags.category, overdue: flags.overdue, dueSoon: flags.dueSoon, blocked: flags.blocked, blockers: flags.blockers,
      // Hours logged on the task: only on a project that tracks time.
      ...(ctx.time ? { loggedHours: Math.round((ctx.logged.get(t.id) || 0) * 100) / 100 } : {}),
      assigneeName: userName(t.assigneeId), subtasks: ctx.children.get(t.id) || 0, checklistDone: t.checklist.filter((i) => i.done).length,
      milestoneIdEffective: milestoneOfTask(t, ctx.byId), watchers: watchersOf(t), files: (t.attachments || []).length, attachments: undefined, images: undefined,
      ticket: ticket ? { id: ticket.id, ref: ticket.ref, status: ticket.status, statusName: TICKET_STATUS[ticket.status] || ticket.status } : null,
    };
  }
  function taskCtx(p) {
    const tasks = tasksOf(p);
    const children = new Map();
    for (const t of tasks) if (t.parentId) children.set(t.parentId, (children.get(t.parentId) || 0) + 1);
    const time = Boolean(p.timeTracking);
    return { tasks, byId: new Map(tasks.map((t) => [t.id, t])), children, time, logged: time ? loggedByTask(p) : new Map(), today: today(), cal: cal() };
  }
  // Hours logged per task of a project (one that tracks time).
  function loggedByTask(p) {
    const m = new Map();
    for (const x of d().pmTimeLogs) if (x.projectId === p.id && x.taskId) m.set(x.taskId, (m.get(x.taskId) || 0) + x.hours);
    return m;
  }
  // No author: made by CORE itself (the starter templates).
  const byName = (id) => (id ? userName(id) || 'Former user' : 'CORE');
  const historyOut = (h) => h.map((e) => ({ ...e, byName: byName(e.by) }));

  // ----- "For you": a notification for each person an event is addressed to -----
  // Never to the person who acted, to a disabled account or to someone who cannot open the
  // project; nothing from templates. The text is short and has no names (they are looked up when
  // read, so a renamed account shows its new name).
  function notify(userIds, kind, p, t, u, text) {
    if (p.isTemplate) return;
    const at = now();
    for (const userId of new Set(userIds)) {
      const x = userId && userId !== u.id && activeUser(userId);
      if (!x || !levelOf(p, x)) continue;
      d().pmNotifications.push({ id: randomUUID(), userId, kind, projectId: p.id, taskId: t?.id || null, actorId: u.id, text: str(text, 140), at, readAt: null });
      d().pmNotifications = pruneNotifications(d().pmNotifications, Date.now(), userId);
    }
  }
  const quote = (body) => `“${str(String(body).replace(/\s+/g, ' '), 90)}${String(body).length > 90 ? '…' : ''}”`;
  // A task moved into Done or Cancelled by someone else: its assignee and watchers are told.
  const closedBy = (t, p, fromId) => {
    const from = statusOf(p, fromId)?.category;
    const to = statusOf(p, t.statusId);
    return to && from !== to.category && ['done', 'cancelled'].includes(to.category) ? to : null;
  };
  function notifyStatus(t, p, u, fromId) {
    const to = closedBy(t, p, fromId);
    if (to) notify([t.assigneeId, ...watchersOf(t)], 'status', p, t, u, `moved ${t.key} to ${to.name}`);
  }
  // Changes to many tasks at once (bulk edit, import): one notification per person for each kind,
  // naming the tasks, instead of one per task. byUser: Map userId → [{ t, … }].
  function notifyGrouped(byUser, kind, p, u, one, many) {
    for (const [userId, list] of byUser) {
      if (list.length === 1) notify([userId], kind, p, list[0].t, u, one(list[0]));
      else notify([userId], kind, p, null, u, many(list));
    }
  }
  const keysOf = (list) => `${list.slice(0, 6).map((x) => x.t.key).join(', ')}${list.length > 6 ? ` and ${list.length - 6} more` : ''}`;
  const addTo = (map, userId, item) => userId && map.set(userId, [...(map.get(userId) || []), item]);

  // ----- Watchers -----
  // A task's watchers hear of its comments and of it being done or cancelled (For you, and the
  // digest's unread count). Creating a task, being assigned it or commenting on it starts watching,
  // except that a comment does not bring back someone who stopped watching (unwatchedBy).
  const watchersOf = (t) => (Array.isArray(t.watchers) ? t.watchers : (t.watchers = []));
  function autoWatch(t, ids, { force = false } = {}) {
    for (const id of ids) {
      if (!id || watchersOf(t).includes(id)) continue;
      if (!force && t.unwatchedBy?.includes(id)) continue;
      t.watchers.push(id);
      if (t.unwatchedBy?.includes(id)) t.unwatchedBy = t.unwatchedBy.filter((x) => x !== id);
    }
  }
  function setWatching(t, id, on) {
    if (on) return autoWatch(t, [id], { force: true });
    t.watchers = watchersOf(t).filter((x) => x !== id);
    if (!t.unwatchedBy?.includes(id)) (t.unwatchedBy ||= []).push(id);
  }
  // Only people who can still open the project watch its tasks.
  const canOpen = (p, id) => {
    const x = activeUser(id);
    return Boolean(x && levelOf(p, x));
  };
  const watcherList = (t) => watchersOf(t).map((id) => ({ userId: id, name: userName(id) || 'Former user' })).sort((a, b) => a.name.localeCompare(b.name));

  // ----- Files on tasks and milestones (server/attachments.js) -----
  // As many as needed (each up to the size limit); anyone who works on the project adds them, the uploader or a manager removes
  // them, and anyone who can open the project downloads them: as a file to save, never shown in
  // the page (Content-Disposition: attachment, its own sandboxing policy).
  const filesOf = (rec) => (Array.isArray(rec.attachments) ? rec.attachments : (rec.attachments = []));
  const fileOut = (a, p, u) => ({ id: a.id, name: a.name, type: a.type, size: a.size, uploadedAt: a.uploadedAt, by: a.by || null, byName: byName(a.by), canDelete: (a.by === u.id && LEVEL[levelOf(p, u)] >= LEVEL.work) || levelOf(p, u) === 'manage' });
  function addFile(rec, body) {
    if (!files) throw new HttpError(500, 'Files cannot be stored here.');
    return { ...files.save(parseUpload(body?.file)) };
  }
  function findFile(rec, fileId) {
    const a = filesOf(rec).find((x) => x.id === fileId);
    if (!a) throw new HttpError(404, 'File not found.');
    return a;
  }
  const mayRemoveFile = (a, p, u) => fileOut(a, p, u).canDelete;
  const removeFiles = (list) => list.forEach((a) => files?.remove(a));
  // A file to save: plain bytes, with a name the browser keeps, and nothing it would open in the page.
  const disposition = (name) => `attachment; filename="${String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  const download = (a) => ({ data: files.buffer(a), headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': disposition(a.name), 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Download-Options': 'noopen' } });
  // ----- Pictures in a task's description -----
  // Uploaded from the description editor (button, paste or drop), shown in the page by <img>. Only
  // JPEG, PNG and WebP whose first bytes say so (never SVG or HTML), sent with that type, nosniff and
  // a sandbox policy, so a picture can only ever be displayed. Anyone who can open the project sees
  // them; anyone who works on it adds them. A picture the description no longer uses is removed when
  // the description is saved (after a grace period, for someone still writing), or with the task.
  const imagesOf = (t) => (Array.isArray(t.images) ? t.images : (t.images = []));
  const imageOut = (x) => ({ id: x.id, name: x.name, type: x.type, size: x.size });
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const showImage = (x) => ({ data: files.buffer(x), headers: { 'Content-Type': x.type, 'Content-Disposition': `inline; filename="${String(x.name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"`, 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400' } });
  function pruneImages(t, nowMs = Date.now()) {
    const used = new Set(imageIdsOf(t.description));
    const [keep, drop] = [[], []];
    for (const x of imagesOf(t)) (used.has(x.id) || nowMs - Date.parse(x.uploadedAt) < IMAGE_GRACE_MS ? keep : drop).push(x);
    if (drop.length) {
      t.images = keep;
      removeFiles(drop);
    }
  }
  // A copied task gets its own copies of the pictures, and its description points at them.
  function copyImages(src, dest) {
    if (!files || !imagesOf(src).length) return;
    const used = new Set(imageIdsOf(src.description));
    const ids = new Map();
    dest.images = [];
    for (const x of imagesOf(src).filter((y) => used.has(y.id))) {
      try {
        const saved = files.save({ name: x.name, type: x.type, buffer: files.buffer(x) });
        ids.set(x.id, saved.id);
        dest.images.push({ ...saved, by: x.by || null });
      } catch {} // a picture missing on disk: the copy shows "Picture not found" for it
    }
    dest.description = String(dest.description || '').replace(/\(img:([0-9a-f-]{36})\)/g, (all, id) => (ids.has(id) ? `(img:${ids.get(id)})` : all));
  }
  // People who became members (not by being assigned a task: that has its own notification).
  function notifyAdded(p, u, beforeIds) {
    const added = p.members.filter((m) => !beforeIds.includes(m.userId));
    for (const m of added) notify([m.userId], 'added', p, null, u, `added you to ${p.code} ${p.name} as ${MEMBER_ROLES[m.role].toLowerCase()}`);
  }

  // ===== Meta: the setup, people to pick, CRM records to link =====
  route('GET', '/api/pm/meta', 'auth', ({ user: u }) => {
    const managesAny = userCan(u, 'pm.edit') || d().pmProjects.some((p) => p.members.some((m) => m.userId === u.id && m.role === 'manager'));
    return {
      types: pm().types, statuses: pm().statuses, sizes: pm().sizes,
      can: { view: userCan(u, 'pm.view'), edit: userCan(u, 'pm.edit'), manage: userCan(u, 'pm.manage') },
      // People to add as members or assignees: for those who can add them.
      people: managesAny ? d().users.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, username: x.username, role: x.role })).sort((a, b) => a.name.localeCompare(b.name)) : [],
      crm: userCan(u, 'crm.view') ? {
        accounts: d().crmAccounts.map((a) => ({ id: a.id, name: a.name, sector: a.sector })).sort((a, b) => a.name.localeCompare(b.name)),
        deals: d().crmDeals.map((x) => ({ id: x.id, code: x.code, title: x.title, accountId: x.accountId, stage: x.stage })),
        contracts: d().crmContracts.map((c) => ({ id: c.id, code: c.code, title: c.title, accountId: c.accountId, endDate: c.endDate, status: c.status })),
      } : null,
    };
  });

  // ===== Portfolio =====
  route('GET', '/api/pm/projects', 'auth', ({ user: u }) => {
    const c = cal();
    return visibleProjects(u).map((p) => summaryOf(p, u, c)).sort((a, b) => a.code.localeCompare(b.code));
  });
  route('GET', '/api/pm/overview', 'auth', ({ user: u }) => {
    const c = cal();
    const projects = visibleProjects(u).map((p) => summaryOf(p, u, c)).sort((a, b) => a.code.localeCompare(b.code));
    const templates = visibleTemplates(u).map((p) => templateOut(p, u)).sort((a, b) => a.name.localeCompare(b.name));
    const open = projects.filter((p) => OPEN_PROJECT.includes(p.status));
    const mine = d().pmTasks.filter((t) => t.assigneeId === u.id).map((t) => ({ t, p: projects.find((x) => x.id === t.projectId) })).filter(({ t, p }) => p && isOpenCategory(categoryOf(p, t)));
    return {
      projects, templates,
      counts: {
        open: open.length, active: open.filter((p) => p.status === 'active').length,
        amber: open.filter((p) => p.health === 'amber').length, red: open.filter((p) => p.health === 'red').length,
        overdueTasks: open.reduce((n, p) => n + p.overdueTasks, 0),
        myOpen: mine.length, myOverdue: mine.filter(({ t }) => t.dueDate && t.dueDate < today()).length,
      },
    };
  });

  // ===== Templates: the list "+ New project" starts from (pm.edit), and the portfolio's Templates =====
  const templateOut = (p, u) => ({
    id: p.id, code: p.code, name: p.name, icon: p.icon || null, iconImage: p.iconImage ? { at: p.iconImage.at } : null, type: p.type, description: p.description, starter: p.starter || null, access: levelOf(p, u),
    milestones: d().pmMilestones.filter((m) => m.projectId === p.id).length, tasks: d().pmTasks.filter((t) => t.projectId === p.id).length,
    deliverables: d().pmMilestones.filter((m) => m.projectId === p.id && m.deliverable).length, updatedAt: p.updatedAt,
  });
  route('GET', '/api/pm/templates', 'pm.edit', ({ user: u }) => visibleTemplates(u).map((p) => templateOut(p, u)).sort((a, b) => a.name.localeCompare(b.name)));

  // ===== Projects =====
  function crmLinks(b, u, rec) {
    const links = { accountId: idOf(b.accountId) || null, dealId: idOf(b.dealId) || null, contractId: idOf(b.contractId) || null };
    const same = links.accountId === (rec.accountId || null) && links.dealId === (rec.dealId || null) && links.contractId === (rec.contractId || null);
    if (same) return links;
    if (!userCan(u, 'crm.view')) throw new HttpError(403, 'Only people with Sales & CRM access can link a project to a client, deal or contract.');
    const acct = links.accountId && d().crmAccounts.find((a) => a.id === links.accountId);
    if (links.accountId && !acct) throw new HttpError(400, 'Pick the client from the list.');
    const deal = links.dealId && d().crmDeals.find((x) => x.id === links.dealId);
    if (links.dealId && !deal) throw new HttpError(400, 'Pick the deal from the list.');
    const contract = links.contractId && d().crmContracts.find((x) => x.id === links.contractId);
    if (links.contractId && !contract) throw new HttpError(400, 'Pick the contract from the list.');
    // A deal or contract fills in the client; one of another client is refused.
    if (!links.accountId) links.accountId = deal?.accountId || contract?.accountId || null;
    for (const [r, what] of [[deal, 'deal'], [contract, 'contract']]) if (r && r.accountId !== links.accountId) throw new HttpError(400, `That ${what} (${r.code}) belongs to ${accountName(r.accountId)}, not to this project's client.`);
    return links;
  }
  function validProject(b, u, rec = {}) {
    const name = str(b.name, 160);
    if (!name) throw new HttpError(400, 'Give the project a name.');
    const type = str(b.type, 40) || rec.type || pm().types[0];
    if (!pm().types.includes(type) && type !== rec.type) throw new HttpError(400, 'Pick a project type from the list.');
    const startDate = optDate(b.startDate, 'Start date');
    if (!startDate) throw new HttpError(400, 'Enter the start date.');
    const endDate = optDate(b.endDate, 'End date');
    if (endDate && endDate < startDate) throw new HttpError(400, 'The end date is before the start date.');
    const managerId = idOf(b.managerId) || rec.managerId || u.id;
    if (managerId !== rec.managerId && !activeUser(managerId)) throw new HttpError(400, 'Pick the project manager from the list of active accounts.');
    // Hours only on a project that tracks time: without it, no budget in hours either.
    const timeTracking = bool(b.timeTracking, 'Track time on this project', Boolean(rec.timeTracking));
    let icon;
    try {
      icon = parseProjectIcon(b.icon);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    return {
      icon,
      name, type, description: str(b.description, 8000), status: oneOf(b.status, PROJECT_STATUS, 'Status', rec.status || 'planning'),
      startDate, endDate, managerId, timeTracking, budgetHours: timeTracking ? optNum(b.budgetHours, 'Budget (hours)', 0, 1000000) : null, ...crmLinks(b, u, rec),
    };
  }
  // The manager is always a member with the manager role.
  function keepManager(p) {
    if (!p.managerId) return;
    const m = p.members.find((x) => x.userId === p.managerId);
    if (m) m.role = 'manager';
    else p.members.unshift({ userId: p.managerId, role: 'manager' });
  }
  function createProject(fields, u, extra = {}) {
    const at = now();
    const p = {
      id: randomUUID(), code: `PRJ-${String(++pm().seq.project).padStart(4, '0')}`, ...fields,
      members: [], statuses: structuredClone(pm().statuses), healthOverride: null, taskSeq: 0, version: 1,
      createdAt: at, createdBy: u.id, updatedAt: at, updatedBy: u.id, history: [{ at, by: u.id, field: 'created', from: '', to: '' }], ...extra,
    };
    keepManager(p);
    // Whoever starts a project for someone else stays on it, as a manager.
    if (!levelOf(p, u)) p.members.push({ userId: u.id, role: 'manager' });
    d().pmProjects.push(p);
    notifyAdded(p, u, []);
    return p;
  }
  route('POST', '/api/pm/projects', 'pm.edit', ({ body, user: u }) => {
    // The members can come with it (a private project: who may see it, from the start).
    const members = body?.members === undefined ? [] : parseMembers(null, body.members);
    const p = createProject(validProject(pickFields(body, PROJECT_FIELDS), u), u, { members });
    db.save();
    return summaryOf(p, u);
  });
  route('GET', '/api/pm/projects/:id', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    const ctx = taskCtx(p);
    const milestones = milestonesOf(p);
    const s = projectStatus(p, milestones, ctx.tasks, ctx.today, ctx.cal);
    const contract = p.contractId && d().crmContracts.find((c) => c.id === p.contractId);
    const leaves = leafTasks(ctx.tasks, p);
    const out = (t) => taskOut(t, p, ctx);
    // Recent changes: task history and comments, newest first.
    const activity = [
      ...ctx.tasks.flatMap((t) => (t.history || []).map((h) => ({ ...h, taskId: t.id, key: t.key, title: t.title }))),
      ...d().pmComments.filter((c) => c.projectId === p.id).map((c) => ({ at: c.createdAt, by: c.userId, field: 'comment', from: '', to: c.body.slice(0, 140), taskId: c.taskId, key: ctx.byId.get(c.taskId)?.key, title: ctx.byId.get(c.taskId)?.title })),
      ...(p.history || []).map((h) => ({ ...h, project: true })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
    const horizon = addDays(ctx.today, 14);
    return {
      ...summaryOf(p, u, ctx.cal),
      history: historyOut(p.history || []),
      healthOverride: p.healthOverride ? { ...p.healthOverride, byName: userName(p.healthOverride.by) } : null,
      deal: userCan(u, 'crm.view') || p.dealId ? crmRef('crmDeals', p.dealId) : null,
      contract: crmRef('crmContracts', p.contractId),
      milestones: milestones.map((m) => ({ ...m, ...s.milestones.find((x) => x.id === m.id), afterContract: Boolean(m.deliverable && contract?.endDate && m.dueDate > contract.endDate), attachments: (m.attachments || []).map((a) => fileOut(a, p, u)) })),
      // Effort: the leaf tasks' sizes (points: their weights), and how many have one.
      effort: { tasks: leaves.length, sized: leaves.filter((t) => isSize(t.size)).length, points: leaves.reduce((n, t) => n + sizeWeight(t.size), 0) },
      // Time: only on a project that tracks time.
      time: ctx.time ? { logged: Math.round(d().pmTimeLogs.filter((x) => x.projectId === p.id).reduce((n, x) => n + x.hours, 0) * 100) / 100, budget: p.budgetHours ?? null } : null,
      counts: { tasks: ctx.tasks.length, open: s.openTasks, overdue: s.overdueTasks, blocked: s.blockedTasks, dueSoon: ctx.tasks.filter((t) => taskFlags(t, p, ctx.byId, ctx.today, ctx.cal).dueSoon).length },
      overdue: ctx.tasks.filter((t) => taskFlags(t, p, ctx.byId, ctx.today, ctx.cal).overdue).map(out).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      upcoming: ctx.tasks.filter((t) => isOpenCategory(categoryOf(p, t)) && t.dueDate && t.dueDate >= ctx.today && t.dueDate <= horizon).map(out).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      blockedList: ctx.tasks.filter((t) => taskFlags(t, p, ctx.byId, ctx.today, ctx.cal).blocked).map(out),
      activity: activity.map((a) => ({ ...a, byName: byName(a.by) })),
      tickets: ticketsFor(p, u),
    };
  });
  // Open service desk tickets of the project's client (requester at one of its contacts' email
  // addresses, or the organization named on the ticket), and tickets linked to its tasks. For agents.
  function ticketsFor(p, u) {
    if (!userCan(u, 'helpdesk.agent')) return null;
    const linked = new Set(d().pmTasks.filter((t) => t.projectId === p.id && t.ticketId).map((t) => t.ticketId));
    const acct = p.accountId && d().crmAccounts.find((a) => a.id === p.accountId);
    const emails = new Set(acct ? d().crmContacts.filter((c) => c.accountId === acct.id && c.email).map((c) => c.email.toLowerCase()) : []);
    return d().tickets.filter((t) => UNRESOLVED_TICKET.includes(t.status) && (linked.has(t.id) || (acct && (emails.has(String(t.requester?.email || '').toLowerCase()) || String(t.requester?.organization || '').trim().toLowerCase() === acct.name.toLowerCase()))))
      .map((t) => ({ id: t.id, ref: t.ref, subject: t.subject, status: t.status, statusName: TICKET_STATUS[t.status], priority: t.priority, linked: linked.has(t.id) }))
      .slice(0, 20);
  }
  route('PUT', '/api/pm/projects/:id', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    fresh(p, body);
    const before = { status: p.status, startDate: p.startDate, endDate: p.endDate, managerId: p.managerId, isTemplate: Boolean(p.isTemplate), timeTracking: Boolean(p.timeTracking), members: p.members.map((m) => m.userId) };
    const isTemplate = bool(body.isTemplate, 'Use as a template', before.isTemplate);
    const next = validProject({ ...p, ...pickFields(body, PROJECT_FIELDS) }, u, p);
    // Members change through their own route (the form saves them first), never with the project.
    checkMembers(p, u, next, null);
    Object.assign(p, next);
    p.isTemplate = isTemplate;
    keepManager(p);
    track(p, u, 'status', PROJECT_STATUS[before.status], PROJECT_STATUS[p.status]);
    track(p, u, 'start', before.startDate, p.startDate);
    track(p, u, 'end', before.endDate, p.endDate);
    track(p, u, 'manager', userName(before.managerId), userName(p.managerId));
    track(p, u, 'template', before.isTemplate ? 'Yes' : 'No', p.isTemplate ? 'Yes' : 'No');
    track(p, u, 'time tracking', before.timeTracking ? 'On' : 'Off', p.timeTracking ? 'On' : 'Off');
    notifyAdded(p, u, before.members);
    bump(p, u);
    db.save();
    return summaryOf(p, u);
  });
  route('DELETE', '/api/pm/projects/:id', 'pm.manage', ({ params, user: u }) => {
    // Deleting needs both: the account type (pm.manage), and managing this project.
    const p = findProject(params.id, u, 'manage');
    removeFiles(projectFiles(d(), p.id));
    removeProject(p.id);
    db.save();
    return { ok: true };
  });
  function removeProject(id) {
    for (const k of PM_COLLECTIONS) d()[k] = d()[k].filter((x) => (k === 'pmProjects' ? x.id !== id : x.projectId !== id));
  }

  // Copy, or a new project from a template: the statuses, milestones (with their deliverable and
  // billing %) and tasks (subtasks, checklists unticked, blocked-by links, sizes), and whether it
  // tracks time. No people, time logged or comments. Dates move with the start date: by the same
  // number of days for a copy, by the same number of working days (weekends and holidays skipped)
  // from a template. The new project's manager and client links can be given (CRM links need
  // Sales & CRM access).
  route('POST', '/api/pm/projects/:id/copy', 'pm.edit', ({ params, body, user: u }) => {
    const src = findProject(params.id, u);
    const name = str(body.name, 160);
    if (!name) throw new HttpError(400, 'Name the new project.');
    const startDate = optDate(body.startDate, 'Start date');
    if (!startDate) throw new HttpError(400, 'Enter the new start date.');
    const c = cal();
    const shift = daysBetween(src.startDate, startDate);
    const move = src.isTemplate ? (v) => shiftWorkDays(v, src.startDate, startDate, c) : (v) => (v ? addDays(v, shift) : null);
    const fields = validProject({
      ...pickFields(body, ['managerId', 'accountId', 'dealId', 'contractId']), name, type: src.type, description: src.description, status: 'planning',
      startDate, endDate: move(src.endDate), timeTracking: Boolean(src.timeTracking), budgetHours: src.timeTracking ? src.budgetHours ?? null : null,
      icon: Object.hasOwn(body || {}, 'icon') ? body.icon : src.icon ?? null,
    }, u, { type: src.type });
    const p = createProject(fields, u, { statuses: structuredClone(src.statuses), copiedFrom: src.id });
    // The source's own picture comes along (a copy of the file), unless another icon was picked.
    if (src.iconImage?.id && files && !Object.hasOwn(body || {}, 'icon')) {
      try {
        const saved = files.save({ name: 'icon', type: src.iconImage.type, buffer: files.buffer(src.iconImage) });
        p.iconImage = { id: saved.id, type: saved.type, size: saved.size, at: saved.uploadedAt };
      } catch {} // the file is missing on disk: the copy shows its icon or letter
    }
    if (src.isTemplate) track(p, u, 'template', '', `${src.code} ${src.name}`);
    const msIds = new Map();
    for (const m of milestonesOf(src)) {
      const id = randomUUID();
      msIds.set(m.id, id);
      d().pmMilestones.push({ id, projectId: p.id, name: m.name, dueDate: move(m.dueDate), deliverable: m.deliverable, billingPercent: m.billingPercent ?? null, submittedAt: null, acceptedAt: null, acceptanceNote: '', order: m.order || 0, version: 1, createdAt: now(), updatedAt: now() });
    }
    const todo = firstStatus(p.statuses, 'todo').id;
    const srcTasks = tasksOf(src).sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0) || byRank(a, b));
    const taskIds = new Map(srcTasks.map((t) => [t.id, randomUUID()]));
    srcTasks.forEach((t, i) => {
      d().pmTasks.push({
        id: taskIds.get(t.id), projectId: p.id, key: `${p.code}-${++p.taskSeq}`, title: t.title, description: t.description, statusId: todo, priority: t.priority,
        assigneeId: null, startDate: move(t.startDate), dueDate: move(t.dueDate), size: isSize(t.size) ? t.size : null, milestoneId: msIds.get(t.milestoneId) || null,
        parentId: taskIds.get(t.parentId) || null, checklist: t.checklist.map((c) => ({ id: randomUUID(), text: c.text, done: false })),
        blockedBy: (t.blockedBy || []).map((x) => taskIds.get(x)).filter(Boolean), ticketId: null, rank: (i + 1) * RANK_STEP, completedAt: null, watchers: [],
        version: 1, createdAt: now(), createdBy: u.id, updatedAt: now(), updatedBy: u.id, history: [{ at: now(), by: u.id, field: 'created', from: '', to: `copied from ${t.key}` }],
      });
      copyImages(t, d().pmTasks[d().pmTasks.length - 1]);
    });
    db.save();
    return summaryOf(p, u);
  });

  // Members: the whole list at once. Removing someone unassigns their open tasks.
  // ----- Members -----
  // The list from a form: [{ userId, role }], active accounts only (someone already on it may stay),
  // nobody twice. `p`: the project as it is (null for a new one).
  function parseMembers(p, list) {
    if (!Array.isArray(list) || list.length > 100) throw new HttpError(400, 'Send the list of members (at most 100).');
    const members = [];
    for (const m of list) {
      const userId = idOf(m?.userId);
      const role = oneOf(m?.role, MEMBER_ROLES, 'Role', 'member');
      const existing = Boolean(p?.members.some((x) => x.userId === userId));
      if (!userId || (!existing && !activeUser(userId))) throw new HttpError(400, 'Pick members from the list of active accounts.');
      if (members.some((x) => x.userId === userId)) throw new HttpError(400, `${userName(userId)} is on the list twice.`);
      members.push({ userId, role });
    }
    return members;
  }
  // Puts the new list in place: open tasks of people taken off are unassigned, those who can no
  // longer open the project stop watching, newcomers are told. Returns how many tasks were unassigned.
  function applyMembers(p, u, members) {
    const gone = p.members.filter((m) => !members.some((x) => x.userId === m.userId)).map((m) => m.userId);
    let unassigned = 0;
    for (const t of tasksOf(p)) if (gone.includes(t.assigneeId) && isOpenCategory(categoryOf(p, t))) {
      track(t, u, 'assignee', userName(t.assigneeId), '');
      t.assigneeId = null;
      bump(t, u);
      unassigned++;
    }
    // A member who is now a viewer keeps their tasks; they can still read and comment.
    const was = p.members.map((m) => m.userId);
    p.members = members;
    keepManager(p);
    // Someone who can no longer open the project stops watching its tasks.
    for (const t of tasksOf(p)) if (watchersOf(t).some((id) => !canOpen(p, id))) t.watchers = t.watchers.filter((id) => canOpen(p, id));
    notifyAdded(p, u, was);
    track(p, u, 'members', '', `${p.members.length} member${p.members.length === 1 ? '' : 's'}`);
    return unassigned;
  }
  // The project as it would be with these fields and members: checked before anything changes.
  function checkMembers(p, u, fields, members) {
    const probe = { ...p, ...fields, members: (members || p.members).map((m) => ({ ...m })) };
    keepManager(probe);
    if (!probe.members.some((m) => m.role === 'manager')) throw new HttpError(400, 'Keep at least one manager on the project.');
    if (!levelOf(probe, u)) throw new HttpError(400, SELF_OFF);
  }
  route('PUT', '/api/pm/projects/:id/members', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    fresh(p, body);
    const members = parseMembers(p, body.members);
    checkMembers(p, u, {}, members);
    const unassigned = applyMembers(p, u, members);
    bump(p, u);
    db.save();
    return { ...summaryOf(p, u), unassigned };
  });

  // The project's statuses (board columns). A removed status that still has tasks needs a
  // status to move them to: { statuses, moveTo: { removedId: targetId } }.
  function validStatuses(list, keep = []) {
    if (!Array.isArray(list)) throw new HttpError(400, 'Send the list of statuses.');
    const out = list.slice(0, 13).map((s) => {
      const id = typeof s?.id === 'string' && keep.some((k) => k.id === s.id) ? s.id : `st-${randomUUID().slice(0, 8)}`;
      const wip = s?.wipLimit == null || s.wipLimit === '' ? null : optNum(s.wipLimit, 'WIP limit', 1, 99);
      return { id, name: str(s?.name, 40), category: oneOf(s?.category, CATEGORIES, 'Category', 'active'), color: oneOf(s?.color, STATUS_COLORS, 'Colour', 'gray'), ...(wip ? { wipLimit: Math.round(wip) } : {}) };
    });
    if (new Set(out.map((s) => s.id)).size !== out.length) throw new HttpError(400, 'Two statuses have the same id.');
    const problem = statusSetProblem(out);
    if (problem) throw new HttpError(400, problem);
    return out;
  }
  route('PUT', '/api/pm/projects/:id/statuses', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    fresh(p, body);
    const statuses = validStatuses(body.statuses, p.statuses);
    const moveTo = body.moveTo && typeof body.moveTo === 'object' ? body.moveTo : {};
    const tasks = tasksOf(p);
    const moves = new Map();
    for (const s of p.statuses.filter((x) => !statuses.some((y) => y.id === x.id))) {
      const n = tasks.filter((t) => t.statusId === s.id).length;
      if (!n) continue;
      const target = statuses.find((x) => x.id === moveTo[s.id]);
      if (!target) throw new HttpError(400, `${n} task${n === 1 ? ' is' : 's are'} in "${s.name}". Choose the status ${n === 1 ? 'it moves' : 'they move'} to.`);
      moves.set(s.id, target);
    }
    for (const t of tasks) {
      const target = moves.get(t.statusId);
      if (!target) continue;
      track(t, u, 'status', statusOf(p, t.statusId)?.name, target.name);
      t.statusId = target.id;
      t.completedAt = target.category === 'done' ? t.completedAt || now() : null;
      t.rank = (Math.max(0, ...tasks.filter((x) => x.statusId === target.id).map((x) => x.rank || 0)) || 0) + RANK_STEP;
      bump(t, u);
    }
    // A status whose category changed: tasks in it are now done or not.
    for (const t of tasks) {
      const cat = statuses.find((s) => s.id === t.statusId)?.category;
      if (cat === 'done' && !t.completedAt) t.completedAt = now();
      if (cat && cat !== 'done') t.completedAt = null;
    }
    p.statuses = statuses;
    bump(p, u);
    db.save();
    return { statuses: p.statuses, version: p.version, moved: [...moves.keys()].length };
  });

  // The manager's own reading of health, shown next to the computed one (which stays visible).
  route('PUT', '/api/pm/projects/:id/health', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    const before = p.healthOverride?.value || null;
    if (body.value === null || body.value === '') p.healthOverride = null;
    else {
      const value = oneOf(body.value, HEALTH, 'Health', null);
      const note = str(body.note, 200);
      if (!value) throw new HttpError(400, 'Pick on track, at risk or off track.');
      if (!note) throw new HttpError(400, 'Say why, in one line: it is shown with the health.');
      p.healthOverride = { value, note, by: u.id, at: now() };
    }
    track(p, u, 'health', HEALTH[before] || 'computed', HEALTH[p.healthOverride?.value] || 'computed');
    bump(p, u);
    db.save();
    return summaryOf(p, u);
  });

  // ===== Milestones =====
  function validMilestone(b, p, rec = {}) {
    const name = str(b.name, 160);
    if (!name) throw new HttpError(400, 'Name the milestone.');
    const dueDate = optDate(b.dueDate, 'Due date');
    if (!dueDate) throw new HttpError(400, 'Enter the milestone\'s due date.');
    const deliverable = bool(b.deliverable, 'Deliverable', rec.deliverable ?? false);
    const billingPercent = deliverable ? optNum(b.billingPercent, 'Billing %', 0, 100) : null;
    const others = d().pmMilestones.filter((m) => m.projectId === p.id && m.id !== rec.id).reduce((n, m) => n + (Number(m.billingPercent) || 0), 0);
    if (billingPercent && others + billingPercent > 100.0001) throw new HttpError(400, `The deliverables would bill ${Math.round((others + billingPercent) * 100) / 100}% of the contract. Keep the total at 100% or less.`);
    let submittedAt = optDate(b.submittedAt, 'Submitted on');
    const acceptedAt = optDate(b.acceptedAt, 'Accepted on');
    if (acceptedAt && !submittedAt) submittedAt = acceptedAt;
    if (acceptedAt && acceptedAt < submittedAt) throw new HttpError(400, 'It cannot be accepted before it was submitted.');
    return { name, dueDate, deliverable, billingPercent, submittedAt, acceptedAt, acceptanceNote: str(b.acceptanceNote, 500) };
  }
  const findMilestone = (p, id) => {
    const m = d().pmMilestones.find((x) => x.id === id && x.projectId === p.id);
    if (!m) throw new HttpError(404, 'Milestone not found.');
    return m;
  };
  route('GET', '/api/pm/projects/:id/milestones', 'auth', ({ params, user: u }) => milestonesOf(findProject(params.id, u)));
  // Burn-up of a milestone: scope, done and the expected line by working day (shared/projects.js).
  route('GET', '/api/pm/projects/:id/milestones/:mid/burnup', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    const m = findMilestone(p, params.mid);
    const ctx = taskCtx(p);
    return { ...milestoneBurnup(m, { project: p, tasks: ctx.tasks, tasksById: ctx.byId, today: ctx.today, cal: ctx.cal }, (iso) => localDate(new Date(iso))), name: m.name, deliverable: m.deliverable };
  });
  route('POST', '/api/pm/projects/:id/milestones', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    const fields = validMilestone(pickFields(body, MILESTONE_FIELDS), p);
    const m = { id: randomUUID(), projectId: p.id, ...fields, order: milestonesOf(p).length, version: 1, createdAt: now(), updatedAt: now(), updatedBy: u.id };
    d().pmMilestones.push(m);
    track(p, u, 'milestone', '', m.name);
    db.save();
    return m;
  });
  route('PUT', '/api/pm/projects/:id/milestones/:mid', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    const m = findMilestone(p, params.mid);
    fresh(m, body);
    const before = { submittedAt: m.submittedAt, acceptedAt: m.acceptedAt, dueDate: m.dueDate };
    Object.assign(m, validMilestone({ ...m, ...pickFields(body, MILESTONE_FIELDS) }, p, m));
    if (before.dueDate !== m.dueDate) track(p, u, `${m.name}: due`, before.dueDate, m.dueDate);
    if (!before.submittedAt && m.submittedAt) track(p, u, `${m.name}: submitted`, '', m.submittedAt);
    if (!before.acceptedAt && m.acceptedAt) track(p, u, `${m.name}: accepted`, '', m.acceptedAt);
    bump(m, u);
    db.save();
    return m;
  });
  route('DELETE', '/api/pm/projects/:id/milestones/:mid', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    const m = findMilestone(p, params.mid);
    for (const t of tasksOf(p)) if (t.milestoneId === m.id) (t.milestoneId = null), bump(t, u);
    removeFiles(m.attachments || []);
    d().pmMilestones = d().pmMilestones.filter((x) => x.id !== m.id);
    track(p, u, 'milestone removed', m.name, '');
    db.save();
    return { ok: true };
  });

  // ===== Tasks =====
  // `level`: the person's access, for adding an assignee who is not a member yet (managers only).
  function validTask(b, p, u, level, rec = {}) {
    const title = str(b.title, 200);
    if (!title) throw new HttpError(400, 'Give the task a title.');
    const statusId = typeof b.statusId === 'string' && b.statusId ? b.statusId : rec.statusId || firstStatus(p.statuses, 'todo').id;
    if (!statusOf(p, statusId)) throw new HttpError(400, 'Pick a status from this project.');
    const startDate = optDate(b.startDate, 'Start date');
    const dueDate = optDate(b.dueDate, 'Due date');
    if (startDate && dueDate && dueDate < startDate) throw new HttpError(400, 'The due date is before the start date.');
    const milestoneId = idOf(b.milestoneId) || null;
    if (milestoneId && !d().pmMilestones.some((m) => m.id === milestoneId && m.projectId === p.id)) throw new HttpError(400, 'Pick a milestone of this project.');
    const tasks = tasksOf(p);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    // One level of subtasks: a subtask's parent is a top-level task, and a task with subtasks stays top-level.
    const parentId = idOf(b.parentId) || null;
    if (parentId) {
      const parent = byId.get(parentId);
      if (!parent) throw new HttpError(400, 'Pick a parent task of this project.');
      if (parentId === rec.id) throw new HttpError(400, 'A task cannot be its own subtask.');
      if (parent.parentId) throw new HttpError(400, `${parent.key} is itself a subtask. Subtasks are one level deep.`);
      if (rec.id && tasks.some((t) => t.parentId === rec.id)) throw new HttpError(400, 'This task has subtasks of its own, so it cannot become a subtask.');
    }
    // Blocked by: tasks of the same project, no loops.
    const raw = b.blockedBy == null ? [] : b.blockedBy;
    if (!Array.isArray(raw) || raw.length > 30) throw new HttpError(400, 'Blocked by: a list of up to 30 tasks.');
    const blockedBy = [...new Set(raw.map(idOf).filter(Boolean))];
    for (const id of blockedBy) if (!byId.has(id)) throw new HttpError(400, 'A task can only wait for tasks in the same project.');
    if (rec.id && blockedBy.includes(rec.id)) throw new HttpError(400, 'A task cannot wait for itself.');
    if (rec.id && makesCycle(byId, rec.id, blockedBy)) throw new HttpError(400, 'That would make a loop: one of those tasks already waits, directly or not, for this one.');
    // The assignee: a member of the project. A manager may assign someone new, who becomes a member.
    const assigneeId = idOf(b.assigneeId) || null;
    if (assigneeId && assigneeId !== rec.assigneeId) {
      const who = activeUser(assigneeId);
      if (!who) throw new HttpError(400, 'Pick the assignee from the list of active accounts.');
      const m = p.members.find((x) => x.userId === assigneeId);
      if (!m && level !== 'manage') throw new HttpError(400, `${who.name} is not on this project. Ask a project manager to add them.`);
      if (m?.role === 'viewer') throw new HttpError(400, `${who.name} is a viewer on this project. A project manager can make them a member.`);
    }
    return {
      title, description: str(b.description, 8000), statusId, priority: oneOf(b.priority, PRIORITY, 'Priority', rec.priority || 'normal'),
      assigneeId, startDate, dueDate, size: validSize(b.size), milestoneId, parentId, blockedBy,
    };
  }
  // A size: XS to XL, or none (empty).
  function validSize(v) {
    if (v == null || v === '') return null;
    if (!isSize(v)) throw new HttpError(400, `Size: pick ${SIZE_KEYS.join(', ')} or none.`);
    return v;
  }
  const addAssignee = (p, t) => {
    if (t.assigneeId && !p.members.some((m) => m.userId === t.assigneeId)) p.members.push({ userId: t.assigneeId, role: 'member' });
  };
  function trackTask(t, p, u, before) {
    const ms = (id) => d().pmMilestones.find((m) => m.id === id)?.name;
    track(t, u, 'status', statusOf(p, before.statusId)?.name, statusOf(p, t.statusId)?.name);
    track(t, u, 'assignee', userName(before.assigneeId), userName(t.assigneeId));
    track(t, u, 'start', before.startDate, t.startDate);
    track(t, u, 'due', before.dueDate, t.dueDate);
    track(t, u, 'milestone', ms(before.milestoneId), ms(t.milestoneId));
    track(t, u, 'priority', PRIORITY[before.priority], PRIORITY[t.priority]);
    track(t, u, 'size', sizeName(before.size), sizeName(t.size));
  }
  const setCompleted = (t, p) => {
    const cat = categoryOf(p, t);
    if (cat === 'done') t.completedAt ||= now();
    else t.completedAt = null;
  };
  const nextRank = (p, statusId, top) => {
    const ranks = tasksOf(p).filter((t) => t.statusId === statusId).map((t) => t.rank || 0);
    if (!ranks.length) return RANK_STEP;
    return top ? Math.min(...ranks) - RANK_STEP : Math.max(...ranks) + RANK_STEP;
  };
  function checklistFrom(v) {
    if (v == null) return [];
    if (!Array.isArray(v) || v.length > 50) throw new HttpError(400, 'A checklist has at most 50 items.');
    return v.map((x) => str(typeof x === 'object' && x ? x.text : x, 300)).filter(Boolean).map((text) => ({ id: randomUUID(), text, done: false }));
  }
  function newTask(p, u, fields, extra = {}) {
    const at = now();
    const t = {
      id: randomUUID(), projectId: p.id, key: `${p.code}-${++p.taskSeq}`, ...fields, checklist: [], ticketId: null, rank: RANK_STEP, completedAt: null,
      watchers: [...new Set([u.id, fields.assigneeId].filter(Boolean))], attachments: [],
      version: 1, createdAt: at, createdBy: u.id, updatedAt: at, updatedBy: u.id, history: [{ at, by: u.id, field: 'created', from: '', to: '' }], ...extra,
    };
    setCompleted(t, p);
    d().pmTasks.push(t);
    return t;
  }
  route('GET', '/api/pm/projects/:id/tasks', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    const ctx = taskCtx(p);
    return ctx.tasks.map((t) => taskOut(t, p, ctx)).sort(byRank);
  });
  route('POST', '/api/pm/projects/:id/tasks', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'work');
    const level = levelOf(p, u);
    const fields = validTask(pickFields(body, TASK_FIELDS), p, u, level);
    const t = newTask(p, u, fields, { checklist: checklistFrom(body.checklist), rank: nextRank(p, fields.statusId, body.position === 'top') });
    addAssignee(p, t);
    notify([t.assigneeId], 'assigned', p, t, u, `assigned you ${t.key} ${t.title}`);
    db.save();
    const ctx = taskCtx(p);
    return taskOut(t, p, ctx);
  });
  route('GET', '/api/pm/tasks/:id', 'auth', ({ params, user: u }) => {
    const { t, p } = findTask(params.id, u);
    const ctx = taskCtx(p);
    const logs = ctx.time ? d().pmTimeLogs.filter((x) => x.taskId === t.id).sort((a, b) => b.date.localeCompare(a.date)) : [];
    const parent = t.parentId && ctx.byId.get(t.parentId);
    return {
      ...taskOut(t, p, ctx), history: historyOut(t.history || []), access: levelOf(p, u),
      project: { id: p.id, code: p.code, name: p.name, icon: p.icon || null, iconImage: p.iconImage ? { at: p.iconImage.at } : null, statuses: p.statuses, members: membersOut(p), timeTracking: ctx.time, isTemplate: Boolean(p.isTemplate) },
      parent: parent ? { id: parent.id, key: parent.key, title: parent.title } : null,
      subtaskList: ctx.tasks.filter((x) => x.parentId === t.id).sort(byRank).map((x) => taskOut(x, p, ctx)),
      blockedByList: t.blockedBy.map((id) => ctx.byId.get(id)).filter(Boolean).map((x) => taskOut(x, p, ctx)),
      blocking: ctx.tasks.filter((x) => x.blockedBy.includes(t.id)).map((x) => ({ id: x.id, key: x.key, title: x.title })),
      // The rest of the project, for the parent and blocked-by pickers.
      others: ctx.tasks.filter((x) => x.id !== t.id).sort(byRank).map((x) => ({ id: x.id, key: x.key, title: x.title, parentId: x.parentId })),
      milestones: milestonesOf(p).map((m) => ({ id: m.id, name: m.name, dueDate: m.dueDate })),
      ...(ctx.time ? { time: logs.map((x) => ({ ...x, userName: userName(x.userId) })), loggedHours: Math.round(logs.reduce((n, x) => n + x.hours, 0) * 100) / 100 } : { time: null }),
      watching: watchersOf(t).includes(u.id), watcherList: watcherList(t), attachments: filesOf(t).map((a) => fileOut(a, p, u)),
      images: imagesOf(t).map(imageOut),
    };
  });
  route('PUT', '/api/pm/tasks/:id', 'auth', ({ params, body, user: u }) => {
    const { t, p } = findTask(params.id, u, 'work');
    fresh(t, body);
    const before = { ...t };
    Object.assign(t, validTask({ ...t, ...pickFields(body, TASK_FIELDS) }, p, u, levelOf(p, u), t));
    if (before.description !== t.description) pruneImages(t);
    if (before.statusId !== t.statusId) t.rank = nextRank(p, t.statusId);
    addAssignee(p, t);
    setCompleted(t, p);
    trackTask(t, p, u, before);
    if (t.assigneeId !== before.assigneeId) notify([t.assigneeId], 'assigned', p, t, u, `assigned you ${t.key} ${t.title}`), autoWatch(t, [t.assigneeId], { force: true });
    notifyStatus(t, p, u, before.statusId);
    bump(t, u);
    db.save();
    return taskOut(t, p, taskCtx(p));
  });
  // Board moves: the status and the neighbours in the new column. No version check (the last
  // move wins), but the version goes up so an open form on the task knows.
  route('PUT', '/api/pm/tasks/:id/move', 'auth', ({ params, body, user: u }) => {
    const { t, p } = findTask(params.id, u, 'work');
    const statusId = typeof body.statusId === 'string' && body.statusId ? body.statusId : t.statusId;
    const status = statusOf(p, statusId);
    if (!status) throw new HttpError(400, 'Pick a status from this project.');
    const column = tasksOf(p).filter((x) => x.statusId === statusId && x.id !== t.id).sort(byRank);
    const place = placeInColumn(column, idOf(body.beforeId), idOf(body.afterId));
    if (place.renumber) for (const x of column) x.rank = place.renumber.get(x.id);
    const from = t.statusId;
    t.statusId = statusId;
    t.rank = place.rank;
    setCompleted(t, p);
    track(t, u, 'status', statusOf(p, from)?.name, status.name);
    notifyStatus(t, p, u, from);
    bump(t, u);
    db.save();
    const wip = status.wipLimit && column.length + 1 > status.wipLimit ? `"${status.name}" has ${column.length + 1} tasks; its limit is ${status.wipLimit}.` : null;
    return { ...taskOut(t, p, taskCtx(p)), wipWarning: wip };
  });
  route('PUT', '/api/pm/tasks/:id/checklist', 'auth', ({ params, body, user: u }) => {
    const { t } = findTask(params.id, u, 'work');
    if (body.add !== undefined) {
      const text = str(body.add, 300);
      if (!text) throw new HttpError(400, 'Write the checklist item.');
      if (t.checklist.length >= 50) throw new HttpError(400, 'A checklist has at most 50 items.');
      t.checklist.push({ id: randomUUID(), text, done: false });
    } else {
      const item = t.checklist.find((i) => i.id === body.itemId);
      if (!item) throw new HttpError(404, 'Checklist item not found.');
      if (body.remove === true) t.checklist = t.checklist.filter((i) => i !== item);
      else if (body.text !== undefined) {
        const text = str(body.text, 300);
        if (!text) throw new HttpError(400, 'Write the checklist item.');
        item.text = text;
      } else item.done = bool(body.done, 'Done');
    }
    bump(t, u);
    db.save();
    return { checklist: t.checklist, version: t.version };
  });
  // Deleting tasks: their subtasks, comments and files go with them; time logged on them stays on
  // the project. Returns the ids removed.
  function removeTasks(p, rootIds) {
    const ids = new Set([...rootIds, ...tasksOf(p).filter((x) => rootIds.includes(x.parentId)).map((x) => x.id)]);
    removeFiles(tasksOf(p).filter((x) => ids.has(x.id)).flatMap((x) => [...(x.attachments || []), ...(x.images || [])]));
    d().pmTasks = d().pmTasks.filter((x) => !ids.has(x.id));
    for (const x of tasksOf(p)) if (x.blockedBy.some((id) => ids.has(id))) x.blockedBy = x.blockedBy.filter((id) => !ids.has(id));
    d().pmComments = d().pmComments.filter((c) => !ids.has(c.taskId));
    d().pmNotifications = d().pmNotifications.filter((n) => !ids.has(n.taskId));
    for (const l of d().pmTimeLogs) if (ids.has(l.taskId)) l.taskId = null;
    return ids;
  }
  const mayDelete = (t, p, u) => levelOf(p, u) === 'manage' || (LEVEL[levelOf(p, u)] >= LEVEL.work && t.createdBy === u.id);
  route('DELETE', '/api/pm/tasks/:id', 'auth', ({ params, user: u }) => {
    const { t, p } = findTask(params.id, u, 'work');
    if (!mayDelete(t, p, u)) throw new HttpError(403, 'Only the person who added the task or a project manager can delete it.');
    const ids = removeTasks(p, [t.id]);
    db.save();
    return { ok: true, removed: ids.size };
  });

  // ===== Comments =====
  route('GET', '/api/pm/tasks/:id/comments', 'auth', ({ params, user: u }) => {
    const { t, p } = findTask(params.id, u);
    const mine = levelOf(p, u);
    return d().pmComments.filter((c) => c.taskId === t.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => ({ ...c, userName: userName(c.userId) || 'Former user', canDelete: c.userId === u.id || mine === 'manage' }));
  });
  route('POST', '/api/pm/tasks/:id/comments', 'auth', ({ params, body, user: u }) => {
    const { t, p } = findTask(params.id, u, 'comment');
    const text = str(body.body, 4000);
    if (!text) throw new HttpError(400, 'Write the comment.');
    const c = { id: randomUUID(), taskId: t.id, projectId: p.id, userId: u.id, body: text, createdAt: now() };
    d().pmComments.push(c);
    // @mentions of the project's members; the task's assignee and the person who added it hear of
    // any other comment (once: a mention is enough).
    const named = new Set(mentionedUsernames(text, p.members.map((m) => user(m.userId)?.username).filter(Boolean)));
    const mentioned = p.members.map((m) => user(m.userId)).filter((x) => x && named.has(x.username.toLowerCase())).map((x) => x.id);
    notify(mentioned, 'mentioned', p, t, u, `mentioned you on ${t.key}: ${quote(text)}`);
    notify([t.assigneeId, t.createdBy, ...watchersOf(t)].filter((id) => !mentioned.includes(id)), 'commented', p, t, u, `commented on ${t.key}: ${quote(text)}`);
    // Commenting starts watching (unless you stopped watching this task); a mention does not.
    if (!p.isTemplate) autoWatch(t, [u.id]);
    db.save();
    return { ...c, userName: u.name, canDelete: true };
  });
  // Your own comment; a project manager can remove any (to take down something posted by mistake).
  route('DELETE', '/api/pm/comments/:id', 'auth', ({ params, user: u }) => {
    const c = d().pmComments.find((x) => x.id === params.id);
    const p = c && d().pmProjects.find((x) => x.id === c.projectId);
    if (!c || !p || !levelOf(p, u)) throw new HttpError(404, 'Comment not found.');
    if (c.userId !== u.id && levelOf(p, u) !== 'manage') throw new HttpError(403, 'You can delete your own comments only.');
    d().pmComments = d().pmComments.filter((x) => x !== c);
    db.save();
    return { ok: true };
  });

  // ===== Watching a task =====
  // { watching: true | false }: for yourself, on any task of a project you can open.
  route('PUT', '/api/pm/tasks/:id/watch', 'auth', ({ params, body, user: u }) => {
    const { t, p } = findTask(params.id, u);
    if (p.isTemplate) throw new HttpError(400, 'Tasks of a template cannot be watched.');
    if (typeof body.watching !== 'boolean') throw new HttpError(400, 'Say whether to watch the task.');
    setWatching(t, u.id, body.watching);
    noAudit(); // a person's own preference, not a change to the project
    db.save();
    return { watching: body.watching, watcherList: watcherList(t) };
  });

  // ===== Files on a task =====
  route('GET', '/api/pm/tasks/:id/attachments/:fileId', 'auth', ({ params, user: u }) => {
    const { t } = findTask(params.id, u);
    return download(findFile(t, params.fileId));
  });
  route('POST', '/api/pm/tasks/:id/attachments', 'auth', ({ params, body, user: u }) => {
    const { t, p } = findTask(params.id, u, 'work');
    const a = { ...addFile(t, body), by: u.id };
    filesOf(t).push(a);
    track(t, u, 'file added', '', a.name);
    bump(t, u);
    db.save();
    return { attachments: filesOf(t).map((x) => fileOut(x, p, u)), version: t.version };
  });
  route('DELETE', '/api/pm/tasks/:id/attachments/:fileId', 'auth', ({ params, user: u }) => {
    const { t, p } = findTask(params.id, u);
    const a = findFile(t, params.fileId);
    if (!mayRemoveFile(a, p, u)) throw new HttpError(403, 'Only the person who added the file or a project manager can remove it.');
    t.attachments = filesOf(t).filter((x) => x !== a);
    removeFiles([a]);
    track(t, u, 'file removed', a.name, '');
    bump(t, u);
    db.save();
    return { attachments: filesOf(t).map((x) => fileOut(x, p, u)), version: t.version };
  });

  // ===== A project's own picture as its icon =====
  // Uploaded by its managers (a square cut in the browser): JPEG, PNG or WebP by content, at most
  // 300 KB. Shown to those who can open the project, as an image only (its type, nosniff, a sandbox
  // policy); the address carries its date, so a new picture is not hidden by the cache. It takes the
  // place of the icon from the set (kept, and shown again when the picture is removed).
  const PICTURE_MAX = 300 * 1024;
  route('GET', '/api/pm/projects/:id/icon', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    if (!p.iconImage?.id || !files) throw new HttpError(404, 'No picture.');
    return showImage({ ...p.iconImage, name: 'icon' });
  });
  route('PUT', '/api/pm/projects/:id/icon', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    if (!files) throw new HttpError(500, 'Files cannot be stored here.');
    const up = parseUpload(body?.file);
    if (!IMAGE_TYPES.includes(up.type)) throw new HttpError(400, 'Use a picture: JPEG, PNG or WebP.');
    if (up.buffer.length > PICTURE_MAX) throw new HttpError(400, `The picture is too large (${Math.ceil(up.buffer.length / 1024)} KB). The limit is ${PICTURE_MAX / 1024} KB.`);
    const old = p.iconImage;
    const saved = files.save({ ...up, name: 'icon' });
    p.iconImage = { id: saved.id, type: saved.type, size: saved.size, at: saved.uploadedAt };
    if (old?.id) removeFiles([old]);
    track(p, u, 'icon', old ? 'picture' : 'set icon', 'picture');
    bump(p, u);
    db.save();
    return summaryOf(p, u);
  });
  route('DELETE', '/api/pm/projects/:id/icon', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    if (!p.iconImage) throw new HttpError(400, 'This project has no picture.');
    removeFiles([p.iconImage]);
    delete p.iconImage;
    track(p, u, 'icon', 'picture', p.icon ? 'set icon' : 'letter');
    bump(p, u);
    db.save();
    return summaryOf(p, u);
  });

  // ===== Pictures in a task's description =====
  route('GET', '/api/pm/tasks/:id/images/:imageId', 'auth', ({ params, user: u }) => {
    const { t } = findTask(params.id, u);
    const x = imagesOf(t).find((y) => y.id === params.imageId);
    if (!x) throw new HttpError(404, 'Picture not found.');
    return showImage(x);
  });
  // Adds a picture; the description that shows it is saved separately (the version is not bumped,
  // so the open editor can still save).
  route('POST', '/api/pm/tasks/:id/images', 'auth', ({ params, body, user: u }) => {
    const { t } = findTask(params.id, u, 'work');
    if (!files) throw new HttpError(500, 'Files cannot be stored here.');
    pruneImages(t);
    const up = parseUpload(body?.file);
    if (!IMAGE_TYPES.includes(up.type)) throw new HttpError(400, 'Insert a picture: JPEG, PNG or WebP.');
    const x = { ...files.save(up), by: u.id };
    imagesOf(t).push(x);
    db.save();
    return imageOut(x);
  });

  // ===== Files on a milestone (for a deliverable: the acceptance document) =====
  // Changes are kept in the project's history, like the milestone's own.
  route('GET', '/api/pm/projects/:id/milestones/:mid/attachments/:fileId', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    return download(findFile(findMilestone(p, params.mid), params.fileId));
  });
  route('POST', '/api/pm/projects/:id/milestones/:mid/attachments', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'work');
    const m = findMilestone(p, params.mid);
    const a = { ...addFile(m, body), by: u.id };
    filesOf(m).push(a);
    track(p, u, `${m.name}: file added`, '', a.name);
    db.save();
    return { attachments: filesOf(m).map((x) => fileOut(x, p, u)) };
  });
  route('DELETE', '/api/pm/projects/:id/milestones/:mid/attachments/:fileId', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    const m = findMilestone(p, params.mid);
    const a = findFile(m, params.fileId);
    if (!mayRemoveFile(a, p, u)) throw new HttpError(403, 'Only the person who added the file or a project manager can remove it.');
    m.attachments = filesOf(m).filter((x) => x !== a);
    removeFiles([a]);
    track(p, u, `${m.name}: file removed`, a.name, '');
    db.save();
    return { attachments: filesOf(m).map((x) => fileOut(x, p, u)) };
  });

  // ===== Bulk edit (the List) =====
  // { ids (1–200 tasks of this project), set: { statusId, assigneeId, milestoneId, priority, size },
  //   shiftDays (± working days, start and due), watchers: { add: [userId], remove: [userId] } }
  // or { ids, delete: true }. Every task is checked first; if one cannot take the change, nothing
  // is saved and the refusal names the tasks. Each task changed gets its history and a new version
  // (like a board move, no version check); notifications are one per person; one audit entry.
  route('POST', '/api/pm/projects/:id/tasks/bulk', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'work');
    const level = levelOf(p, u);
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > BULK_MAX) throw new HttpError(400, `Pick from 1 to ${BULK_MAX} tasks.`);
    const ids = [...new Set(body.ids.map(idOf))];
    const byId = new Map(tasksOf(p).map((t) => [t.id, t]));
    if (ids.some((id) => !byId.has(id))) throw new HttpError(404, 'Task not found.');
    const picked = ids.map((id) => byId.get(id));
    if (body.delete === true) {
      const refused = picked.filter((t) => !mayDelete(t, p, u));
      if (refused.length) throw new HttpError(403, `Nothing was deleted. Only the person who added a task or a project manager can delete it: ${refused.slice(0, 10).map((t) => t.key).join(', ')}${refused.length > 10 ? '…' : ''}.`);
      const gone = removeTasks(p, picked.map((t) => t.id));
      audit?.record('projects.bulk', { entity: 'project', entityId: p.id, label: `${p.code} ${p.name}`, note: `Deleted ${gone.size} task${gone.size === 1 ? '' : 's'} (subtasks included)` });
      db.save();
      return { removed: gone.size };
    }
    const set = body.set && typeof body.set === 'object' && !Array.isArray(body.set) ? pickFields(body.set, BULK_FIELDS) : {};
    const changes = {};
    const what = [];
    if (Object.hasOwn(set, 'statusId')) {
      const s = typeof set.statusId === 'string' && statusOf(p, set.statusId);
      if (!s) throw new HttpError(400, 'Pick a status from this project.');
      changes.statusId = s.id;
      what.push(`status ${s.name}`);
    }
    if (Object.hasOwn(set, 'assigneeId')) {
      const id = idOf(set.assigneeId) || null;
      const m = id && p.members.find((x) => x.userId === id);
      if (id && (!m || m.role === 'viewer' || !activeUser(id))) throw new HttpError(400, 'Pick the assignee from the project\'s members.');
      changes.assigneeId = id;
      what.push(`assignee ${id ? userName(id) : 'none'}`);
    }
    if (Object.hasOwn(set, 'milestoneId')) {
      const id = idOf(set.milestoneId) || null;
      const m = id && d().pmMilestones.find((x) => x.id === id && x.projectId === p.id);
      if (id && !m) throw new HttpError(400, 'Pick a milestone of this project.');
      changes.milestoneId = id;
      what.push(`milestone ${m ? m.name : 'none'}`);
    }
    if (Object.hasOwn(set, 'priority')) {
      changes.priority = oneOf(set.priority, PRIORITY, 'Priority', null);
      if (!changes.priority) throw new HttpError(400, 'Priority: pick one of the options.');
      what.push(`priority ${PRIORITY[changes.priority]}`);
    }
    if (Object.hasOwn(set, 'size')) {
      changes.size = validSize(set.size);
      what.push(`size ${changes.size ? sizeName(changes.size) : 'none'}`);
    }
    let shift = 0;
    if (body.shiftDays !== undefined && body.shiftDays !== null && body.shiftDays !== 0) {
      shift = body.shiftDays;
      if (!Number.isInteger(shift) || Math.abs(shift) > 260) throw new HttpError(400, 'Move the dates by a whole number of working days, at most 260 either way.');
      what.push(`dates moved ${shift > 0 ? '+' : ''}${shift} working day${Math.abs(shift) === 1 ? '' : 's'}`);
    }
    const w = body.watchers && typeof body.watchers === 'object' && !Array.isArray(body.watchers) ? body.watchers : {};
    const list = (v) => {
      if (v == null) return [];
      if (!Array.isArray(v) || v.length > 100) throw new HttpError(400, 'Watchers: a list of people.');
      return [...new Set(v.map(idOf).filter(Boolean))];
    };
    const watchAdd = list(w.add);
    const watchRemove = list(w.remove);
    if (level !== 'manage' && [...watchAdd, ...watchRemove].some((id) => id !== u.id)) throw new HttpError(403, 'You can add or remove only yourself as a watcher. A project manager can add others.');
    for (const id of watchAdd) if (!canOpen(p, id)) throw new HttpError(400, `${userName(id) || 'That account'} cannot open this project, so cannot watch its tasks.`);
    if (watchAdd.length) what.push(`watchers + ${watchAdd.map((id) => userName(id)).join(', ')}`);
    if (watchRemove.length) what.push(`watchers − ${watchRemove.map((id) => userName(id) || 'Former user').join(', ')}`);
    if (!what.length) throw new HttpError(400, 'Choose a change to make.');
    // First check every task; nothing is saved unless all of them can take the change.
    const c = cal();
    const plans = [];
    const problems = [];
    for (const t of picked) {
      const next = { ...changes };
      if (shift) {
        if (t.startDate) next.startDate = addWorkDays(t.startDate, shift, c);
        if (t.dueDate) next.dueDate = addWorkDays(t.dueDate, shift, c);
      }
      try {
        validTask({ ...t, ...next }, p, u, level, t);
        plans.push([t, next]);
      } catch (err) {
        problems.push(`${t.key}: ${err.message}`);
      }
    }
    if (problems.length) throw new HttpError(400, `Nothing was changed: ${problems.length === 1 ? 'one task cannot' : `${problems.length} tasks cannot`} take this change. ${problems.slice(0, 8).join(' ')}${problems.length > 8 ? ' …' : ''}`);
    const assigned = new Map();
    const closed = new Map();
    for (const [t, next] of plans) {
      const before = { ...t };
      Object.assign(t, next);
      if (before.statusId !== t.statusId) t.rank = nextRank(p, t.statusId);
      setCompleted(t, p);
      trackTask(t, p, u, before);
      if (t.assigneeId && t.assigneeId !== before.assigneeId) addTo(assigned, t.assigneeId, { t }), autoWatch(t, [t.assigneeId], { force: true });
      const to = closedBy(t, p, before.statusId);
      if (to) for (const id of new Set([t.assigneeId, ...watchersOf(t)])) addTo(closed, id, { t, to });
      const watching = [...watchersOf(t)];
      for (const id of watchAdd) setWatching(t, id, true);
      for (const id of watchRemove) setWatching(t, id, false);
      const names = (ids) => ids.map((id) => userName(id) || 'Former user').join(', ');
      if (watching.join() !== watchersOf(t).join()) track(t, u, 'watchers', names(watching), names(t.watchers));
      bump(t, u);
    }
    notifyGrouped(assigned, 'assigned', p, u, ({ t }) => `assigned you ${t.key} ${t.title}`, (l) => `assigned you ${l.length} tasks in ${p.code}: ${keysOf(l)}`);
    notifyGrouped(closed, 'status', p, u, ({ t, to }) => `moved ${t.key} to ${to.name}`, (l) => `moved ${l.length} tasks to ${[...new Set(l.map((x) => x.to.name))].join(' or ')}: ${keysOf(l)}`);
    audit?.record('projects.bulk', { entity: 'project', entityId: p.id, label: `${p.code} ${p.name}`, note: `${plans.length} task${plans.length === 1 ? '' : 's'}: ${what.join('; ')}`.slice(0, 500) });
    db.save();
    const ctx = taskCtx(p);
    return { changed: plans.length, tasks: plans.map(([t]) => taskOut(t, p, ctx)) };
  });

  // ===== Import tasks from a CSV file (project managers) =====
  // The file's text is sent as it is ({ csv }); it is read here (shared/csv.js). preview: the
  // columns and how they are matched. import: { csv, mapping, createMilestones, dryRun } checks
  // every row (dryRun: and stops there), or creates every task, all or nothing.
  function readCsv(body) {
    if (typeof body.csv !== 'string' || !body.csv.trim()) throw new HttpError(400, 'Choose a CSV file.');
    if (Buffer.byteLength(body.csv, 'utf8') > IMPORT_MAX_BYTES) throw new HttpError(400, `The file is larger than ${IMPORT_MAX_BYTES / 1048576} MB. Split it into smaller files.`);
    const { rows, error } = parseCsv(body.csv);
    if (error) throw new HttpError(400, `The file could not be read: ${error}`);
    if (rows.length < 2) throw new HttpError(400, 'The file has no task rows under its header row.');
    if (rows.length - 1 > IMPORT_MAX_ROWS) throw new HttpError(400, `The file has ${rows.length - 1} rows; at most ${IMPORT_MAX_ROWS.toLocaleString('en-US')} can be imported at once.`);
    return { headers: rows[0].map((h) => str(h, 100)), rows: rows.slice(1) };
  }
  function validMapping(v, columns) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Say which column holds what.');
    const out = {};
    for (const field of Object.keys(IMPORT_FIELDS)) {
      const c = v[field];
      if (c === undefined || c === null || c === '') continue;
      const n = Number(c);
      if (!Number.isInteger(n) || n < 0 || n >= columns) throw new HttpError(400, `${IMPORT_FIELDS[field].label}: pick one of the file's columns.`);
      out[field] = n;
    }
    if (out.title === undefined) throw new HttpError(400, 'Pick the column that holds the task titles.');
    const used = Object.values(out);
    if (new Set(used).size !== used.length) throw new HttpError(400, 'Each column can fill one field only.');
    return out;
  }
  route('POST', '/api/pm/projects/:id/import/preview', 'auth', ({ params, body, user: u }) => {
    findProject(params.id, u, 'manage');
    const { headers, rows } = readCsv(body);
    noAudit(); // reading a file changes nothing
    return { headers, mapping: guessImportMapping(headers), sample: rows.slice(0, 5).map((r) => headers.map((_, i) => str(r[i], 120))), count: rows.length };
  });
  route('POST', '/api/pm/projects/:id/import', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    const { headers, rows } = readCsv(body);
    const mapping = validMapping(body.mapping, headers.length);
    const createMilestones = bool(body.createMilestones, 'Create the milestones that are missing', false);
    const dryRun = bool(body.dryRun, 'Check only', false);
    const plan = importPlan(rows, mapping, { project: p, members: membersOut(p), milestones: milestonesOf(p), createMilestones });
    const summary = { tasks: plan.tasks.length, subtasks: plan.tasks.filter((t) => t.parentRow).length, newMilestones: plan.newMilestones, errorCount: plan.errorCount, fromHours: plan.fromHours, rows: plan.rows };
    if (dryRun) {
      noAudit();
      return summary;
    }
    if (plan.errorCount) throw new HttpError(400, `Nothing was imported: ${plan.errorCount === 1 ? 'one row has' : `${plan.errorCount} rows have`} problems. Check the file again to see them.`);
    const at = now();
    const msIds = new Map();
    for (const m of plan.newMilestones) {
      const rec = { id: randomUUID(), projectId: p.id, name: m.name, dueDate: m.dueDate, deliverable: false, billingPercent: null, submittedAt: null, acceptedAt: null, acceptanceNote: '', order: milestonesOf(p).length, version: 1, createdAt: at, updatedAt: at, updatedBy: u.id };
      d().pmMilestones.push(rec);
      msIds.set(m.name.toLowerCase(), rec.id);
      track(p, u, 'milestone', '', `${m.name} (imported)`);
    }
    const rowIds = new Map(plan.tasks.map((t) => [t.row, randomUUID()]));
    const assigned = new Map();
    for (const r of plan.tasks) {
      const milestoneId = r.milestone ? r.milestone.id || msIds.get(r.milestone.name.toLowerCase()) : null;
      const fields = {
        title: r.title, description: r.description, statusId: r.statusId, priority: r.priority, assigneeId: r.assigneeId, startDate: r.startDate, dueDate: r.dueDate,
        size: r.size, milestoneId, parentId: r.parentRow ? rowIds.get(r.parentRow) : null, blockedBy: [],
      };
      const t = newTask(p, u, fields, { id: rowIds.get(r.row), checklist: r.checklist.map((text) => ({ id: randomUUID(), text, done: false })), rank: nextRank(p, r.statusId) });
      t.history[0].to = 'imported from a CSV file';
      addTo(assigned, t.assigneeId, { t });
    }
    notifyGrouped(assigned, 'assigned', p, u, ({ t }) => `assigned you ${t.key} ${t.title}`, (l) => `assigned you ${l.length} tasks in ${p.code}: ${keysOf(l)}`);
    const name = str(body.fileName, 120);
    audit?.record('projects.import', { entity: 'project', entityId: p.id, label: `${p.code} ${p.name}`, note: `${plan.tasks.length} tasks imported${name ? ` from ${name}` : ''}${plan.newMilestones.length ? `; ${plan.newMilestones.length} milestones added` : ''}${plan.fromHours ? `; ${plan.fromHours} sizes from hour estimates` : ''}` });
    db.save();
    return { imported: plan.tasks.length, milestones: plan.newMilestones.length };
  });

  // ===== Time (only on projects that track time) =====
  // A project tracks time when a manager turns it on (timeTracking). Without it there are no hours
  // in it at all: no Time tab, no logging on its tasks, no budget, nothing on the Timesheet.
  function needTracking(p) {
    if (p.isTemplate) throw new HttpError(400, `${p.code} is a template. Time is logged on projects.`);
    if (!p.timeTracking) throw new HttpError(400, `${p.code} does not track time. A project manager can turn it on under Edit: Track time on this project.`);
  }
  // Hours a person attended on a day, from the DTR (null when CORE cannot tell: no linked
  // employee record, or still clocked in). For comparison only: nothing is filled in from it.
  function attendedHours(userId, date) {
    const emp = d().employees.find((e) => e.id === user(userId)?.employeeId);
    if (!emp) return null;
    const entries = d().timeEntries.filter((e) => e.employeeId === emp.id && e.date === date);
    if (entries.some((e) => e.type === 'work' && e.timeIn && !e.timeOut)) return null;
    const schedule = scheduleFor(emp, d().settings);
    return Math.round(entries.reduce((n, e) => n + computeEntry(e, schedule, d().settings).workedMinutes, 0) / 6) / 10;
  }
  const loggedOn = (userId, date) => d().pmTimeLogs.filter((x) => x.userId === userId && x.date === date).reduce((n, x) => n + x.hours, 0);
  // The check against attendance is shown to the person and to those who may see attendance.
  const mayCheck = (u, p, userId) => userId === u.id || levelOf(p, u) === 'manage' || userCan(u, 'attendance.view');
  function timeOut(x, u, p, cache) {
    const key = `${x.userId}|${x.date}`;
    if (!cache.has(key)) {
      const attended = attendedHours(x.userId, x.date);
      const logged = loggedOn(x.userId, x.date);
      cache.set(key, { attended, over: attended !== null && logged > attended + 1e-9, logged });
    }
    const chk = cache.get(key);
    const t = x.taskId && d().pmTasks.find((y) => y.id === x.taskId);
    return {
      ...x, userName: userName(x.userId) || 'Former user', taskKey: t?.key || null, taskTitle: t?.title || null,
      ...(mayCheck(u, p, x.userId) ? { attended: chk.attended, dayTotal: Math.round(chk.logged * 100) / 100, overAttended: chk.over } : {}),
      canDelete: x.userId === u.id || levelOf(p, u) === 'manage',
    };
  }
  // Hours from a form: a number, or text of digits.
  const hoursOf = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN);
  route('GET', '/api/pm/projects/:id/time', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    needTracking(p);
    const logs = d().pmTimeLogs.filter((x) => x.projectId === p.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const cache = new Map();
    const sum = (list) => Math.round(list.reduce((n, x) => n + x.hours, 0) * 100) / 100;
    const people = [...new Set(logs.map((x) => x.userId))].map((id) => ({ userId: id, name: userName(id) || 'Former user', hours: sum(logs.filter((x) => x.userId === id)), member: isWorker(p, id) })).sort((a, b) => b.hours - a.hours);
    const tasks = tasksOf(p);
    const byTask = tasks.map((t) => ({ taskId: t.id, key: t.key, title: t.title, size: isSize(t.size) ? t.size : null, hours: sum(logs.filter((x) => x.taskId === t.id)) })).filter((x) => x.hours);
    const noTask = sum(logs.filter((x) => !x.taskId));
    const week = weekStart(today());
    return {
      entries: logs.slice(0, 500).map((x) => timeOut(x, u, p, cache)),
      mine: logs.filter((x) => x.userId === u.id && x.date >= week).map((x) => timeOut(x, u, p, cache)),
      byPerson: people, byTask: byTask.sort((a, b) => b.hours - a.hours), noTask, total: sum(logs), budget: p.budgetHours ?? null,
      tasks: tasks.filter((t) => isOpenCategory(categoryOf(p, t)) || logs.some((x) => x.taskId === t.id)).sort(byRank).map((t) => ({ id: t.id, key: t.key, title: t.title })),
    };
  });
  route('POST', '/api/pm/projects/:id/time', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'work');
    needTracking(p);
    const date = optDate(body.date, 'Date');
    if (!date) throw new HttpError(400, 'Pick the date.');
    if (date > today()) throw new HttpError(400, 'Time can be logged for today or earlier.');
    const hours = hoursOf(body.hours);
    if (!validHours(hours)) throw new HttpError(400, 'Hours must be from 0.25 to 24, in quarter hours (0.25, 0.5, 0.75…).');
    const taskId = idOf(body.taskId) || null;
    const task = taskId && d().pmTasks.find((t) => t.id === taskId && t.projectId === p.id);
    if (taskId && !task) throw new HttpError(400, 'Pick a task of this project.');
    if (loggedOn(u.id, date) + hours > MAX_DAY_HOURS) throw new HttpError(400, 'That would be more than 24 hours logged on one day.');
    const x = { id: randomUUID(), projectId: p.id, taskId, userId: u.id, date, hours, note: str(body.note, 500), createdAt: now() };
    d().pmTimeLogs.push(x);
    db.save();
    const out = timeOut(x, u, p, new Map());
    return { ...out, warning: out.overAttended ? overNote(out.dayTotal, out.attended, date) : null };
  });
  const overNote = (logged, attended, date) => `You have logged ${Math.round(logged * 100) / 100} h on ${date}, more than the ${attended} h your attendance shows. It is saved; this is only for your information.`;
  route('DELETE', '/api/pm/projects/:id/time/:entryId', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    needTracking(p);
    const x = d().pmTimeLogs.find((y) => y.id === params.entryId && y.projectId === p.id);
    if (!x) throw new HttpError(404, 'Time entry not found.');
    if (x.userId !== u.id && levelOf(p, u) !== 'manage') throw new HttpError(403, 'You can delete your own time entries only.');
    d().pmTimeLogs = d().pmTimeLogs.filter((y) => y !== x);
    db.save();
    return { ok: true };
  });

  // ===== The weekly Timesheet =====
  // A person's hours on the projects that track time, Monday to Sunday: a row per project and task
  // (or the project without a task). Saving writes one time entry per project, task and day (it
  // replaces what was logged there), only ever for the person saving, and only on projects that
  // track time where they are a member. The same checks as logging: today or earlier, quarter
  // hours, at most 24 h a day across projects. Separate from attendance: the DTR's hours are shown
  // under it for comparison only (to the person, the project's managers and attendance.view, as on
  // the Time tab), and a day with more project hours than attended is flagged, never refused.
  // Managers open their members' timesheets, read only.
  const isWorker = (p, userId) => p.members.some((m) => m.userId === userId && m.role !== 'viewer');
  const trackedProjects = () => d().pmProjects.filter((p) => p.timeTracking && !p.isTemplate);
  // The projects of `target`'s timesheet that `u` sees: all of their own; a manager, those they manage.
  const sheetProjects = (u, target) => trackedProjects().filter((p) => isWorker(p, target.id) && (target.id === u.id || levelOf(p, u) === 'manage'));
  function sheetPeople(u) {
    const ids = new Set();
    for (const p of trackedProjects()) {
      if (levelOf(p, u) === 'manage') for (const m of p.members) if (m.role !== 'viewer') ids.add(m.userId);
      if (isWorker(p, u.id)) ids.add(u.id);
    }
    return [...ids].map((id) => ({ id, name: userName(id) || 'Former user', self: id === u.id })).sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name));
  }
  function timesheetOf(u, target, week) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
    const projects = sheetProjects(u, target).sort((a, b) => a.code.localeCompare(b.code));
    const shown = new Set(projects.map((p) => p.id));
    const logs = d().pmTimeLogs.filter((x) => x.userId === target.id && x.date >= days[0] && x.date <= days[6] && shown.has(x.projectId));
    const rows = new Map();
    const rowOf = (projectId, taskId) => {
      const k = `${projectId}|${taskId || ''}`;
      if (!rows.has(k)) rows.set(k, { projectId, taskId: taskId || null, hours: days.map(() => 0), notes: [] });
      return rows.get(k);
    };
    for (const x of logs) {
      const r = rowOf(x.projectId, x.taskId);
      r.hours[days.indexOf(x.date)] += x.hours;
      if (x.note && !r.notes.includes(x.note)) r.notes.push(x.note);
    }
    for (const p of projects) if (![...rows.values()].some((r) => r.projectId === p.id)) rowOf(p.id, null);
    const r2 = (n) => Math.round(n * 100) / 100;
    const out = projects.map((p) => {
      const used = new Set([...rows.values()].filter((r) => r.projectId === p.id && r.taskId).map((r) => r.taskId));
      return {
        id: p.id, code: p.code, name: p.name, icon: p.icon || null, iconImage: p.iconImage ? { at: p.iconImage.at } : null, manage: levelOf(p, u) === 'manage',
        tasks: tasksOf(p).filter((t) => used.has(t.id) || isOpenCategory(categoryOf(p, t))).sort(byRank).map((t) => ({ id: t.id, key: t.key, title: t.title, size: isSize(t.size) ? t.size : null })),
      };
    });
    const order = new Map(projects.map((p, i) => [p.id, i]));
    const keyOf = (r) => d().pmTasks.find((t) => t.id === r.taskId)?.key || '';
    const list = [...rows.values()].map((r) => ({ ...r, hours: r.hours.map(r2), total: r2(r.hours.reduce((n, h) => n + h, 0)) }))
      .sort((a, b) => order.get(a.projectId) - order.get(b.projectId) || Number(Boolean(a.taskId)) - Number(Boolean(b.taskId)) || keyOf(a).localeCompare(keyOf(b), undefined, { numeric: true }));
    const totals = days.map((_, i) => r2(list.reduce((n, r) => n + r.hours[i], 0)));
    // The DTR, for comparison only (the rule of the Time tab).
    const check = target.id === u.id || userCan(u, 'attendance.view') || projects.some((p) => mayCheck(u, p, target.id));
    const attendance = check ? days.map((x) => attendedHours(target.id, x)) : null;
    const allLogged = days.map((x) => loggedOn(target.id, x));
    return {
      week, days, today: today(), user: { id: target.id, name: target.name }, self: target.id === u.id, editable: target.id === u.id,
      people: sheetPeople(u), projects: out, rows: list, totals, total: r2(totals.reduce((n, h) => n + h, 0)), maxDay: MAX_DAY_HOURS,
      attendance, over: attendance ? days.map((x, i) => attendance[i] !== null && allLogged[i] > attendance[i] + 1e-9) : null,
    };
  }
  const weekOf = (v) => (isDate(v) ? weekStart(v) : weekStart(today()));
  route('GET', '/api/pm/timesheet', 'auth', ({ query, user: u }) => {
    const target = query.user && query.user !== u.id ? user(String(query.user)) : u;
    if (!target || (target.id !== u.id && !sheetProjects(u, target).length)) throw new HttpError(404, 'Timesheet not found.');
    return timesheetOf(u, target, weekOf(query.week));
  });
  // { week, cells: [{ projectId, taskId (or null), date, hours (0 or empty clears it) }] }: the cells
  // changed. Every cell is checked first; if one cannot be saved, nothing is.
  route('PUT', '/api/pm/timesheet', 'auth', ({ body, user: u }) => {
    if (!isDate(body.week)) throw new HttpError(400, 'Say which week the timesheet is for.');
    const week = weekStart(body.week);
    const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
    if (!Array.isArray(body.cells) || !body.cells.length || body.cells.length > TIMESHEET_MAX_CELLS) throw new HttpError(400, `Send the cells that changed (1 to ${TIMESHEET_MAX_CELLS}).`);
    const plan = new Map();
    for (const c of body.cells) {
      const p = d().pmProjects.find((x) => x.id === idOf(c?.projectId));
      if (!p || !levelOf(p, u)) throw new HttpError(404, 'Project not found.');
      if (!isWorker(p, u.id)) throw new HttpError(403, `Only the members of ${p.code} log time on it.`);
      needTracking(p);
      const taskId = idOf(c.taskId) || null;
      if (taskId && !d().pmTasks.some((t) => t.id === taskId && t.projectId === p.id)) throw new HttpError(400, `Pick a task of ${p.code}.`);
      if (!isDate(c.date) || !days.includes(c.date)) throw new HttpError(400, 'Each day must be in the week shown.');
      const hours = c.hours == null || c.hours === '' ? 0 : hoursOf(c.hours);
      if (hours !== 0 && !validHours(hours)) throw new HttpError(400, 'Hours must be from 0.25 to 24, in quarter hours (0.25, 0.5, 0.75…). Leave a day empty for none.');
      if (hours && c.date > today()) throw new HttpError(400, 'Time can be logged for today or earlier.');
      plan.set(`${p.id}|${taskId || ''}|${c.date}`, { p, taskId, date: c.date, hours });
    }
    // At most 24 hours a day, across every project, after the save.
    const mine = d().pmTimeLogs.filter((x) => x.userId === u.id);
    const cellKey = (x) => `${x.projectId}|${x.taskId || ''}|${x.date}`;
    for (const date of new Set([...plan.values()].map((c) => c.date))) {
      const kept = mine.filter((x) => x.date === date && !plan.has(cellKey(x))).reduce((n, x) => n + x.hours, 0);
      const total = kept + [...plan.values()].filter((c) => c.date === date).reduce((n, c) => n + c.hours, 0);
      if (total > MAX_DAY_HOURS + 1e-9) throw new HttpError(400, `Nothing was saved: that would be ${Math.round(total * 100) / 100} h on ${date}, more than 24 hours on one day.`);
    }
    let saved = 0;
    const drop = new Set();
    for (const [k, c] of plan) {
      const same = mine.filter((x) => cellKey(x) === k);
      const before = same.reduce((n, x) => n + x.hours, 0);
      if (Math.abs(before - c.hours) < 1e-9) continue;
      saved++;
      if (!c.hours) {
        same.forEach((x) => drop.add(x));
        continue;
      }
      if (same.length) {
        // One entry for the cell: the first keeps its id, with the notes of the others.
        const [first, ...rest] = same;
        first.hours = c.hours;
        first.note = str([...new Set(same.map((x) => x.note).filter(Boolean))].join('; '), 500);
        first.updatedAt = now();
        rest.forEach((x) => drop.add(x));
      } else d().pmTimeLogs.push({ id: randomUUID(), projectId: c.p.id, taskId: c.taskId, userId: u.id, date: c.date, hours: c.hours, note: '', createdAt: now(), via: 'timesheet' });
    }
    if (drop.size) d().pmTimeLogs = d().pmTimeLogs.filter((x) => !drop.has(x));
    if (saved) db.save();
    else noAudit();
    // For information only: the days just saved with more project hours than attended.
    const sheet = timesheetOf(u, u, week);
    const savedDays = new Set([...plan.values()].map((c) => c.date));
    const warnings = sheet.over ? sheet.days.filter((x, i) => sheet.over[i] && savedDays.has(x)).map((x) => overNote(loggedOn(u.id, x), sheet.attendance[sheet.days.indexOf(x)], x)) : [];
    return { ...sheet, saved, warnings };
  });

  // ===== My work: my open tasks across the projects I can still open =====
  route('GET', '/api/pm/my-work', 'auth', ({ user: u }) => {
    const t0 = today();
    const groups = { overdue: [], today: [], week: [], later: [], none: [] };
    const ctxs = new Map();
    for (const t of d().pmTasks) {
      if (t.assigneeId !== u.id) continue;
      const p = d().pmProjects.find((x) => x.id === t.projectId);
      if (!p || p.isTemplate || !levelOf(p, u) || !isOpenCategory(categoryOf(p, t))) continue;
      if (!ctxs.has(p.id)) ctxs.set(p.id, taskCtx(p));
      groups[myWorkGroup(t, t0)].push({ ...taskOut(t, p, ctxs.get(p.id)), project: { id: p.id, code: p.code, name: p.name, icon: p.icon || null, iconImage: p.iconImage ? { at: p.iconImage.at } : null, statuses: p.statuses }, access: levelOf(p, u) });
    }
    for (const list of Object.values(groups)) list.sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9') || byRank(a, b));
    return groups;
  });

  // ===== "For you": my notifications (only ever the signed-in person's own) =====
  // Those about projects I can no longer open are left out (not deleted: access may come back).
  function myNotifications(u) {
    d().pmNotifications = pruneNotifications(d().pmNotifications, Date.now(), u.id);
    const projects = new Map();
    const open = (id) => {
      if (!projects.has(id)) {
        const p = d().pmProjects.find((x) => x.id === id);
        projects.set(id, p && !p.isTemplate && levelOf(p, u) ? p : null);
      }
      return projects.get(id);
    };
    return d().pmNotifications.filter((n) => n.userId === u.id && open(n.projectId)).sort((a, b) => b.at.localeCompare(a.at)).map((n) => {
      const p = open(n.projectId);
      const t = n.taskId && d().pmTasks.find((x) => x.id === n.taskId);
      return {
        id: n.id, kind: n.kind, text: n.text, at: n.at, readAt: n.readAt, actorId: n.actorId || null, actorName: userName(n.actorId) || 'Someone',
        projectId: p.id, projectCode: p.code, projectName: p.name, taskId: t ? t.id : null, taskKey: t?.key || null, taskTitle: t?.title || null,
      };
    });
  }
  route('GET', '/api/pm/notifications', 'auth', ({ user: u, query }) => {
    const all = myNotifications(u);
    const unread = all.filter((n) => !n.readAt).length;
    return { unread, items: (query.unread === '1' ? all.filter((n) => !n.readAt) : all).slice(0, 100) };
  });
  route('GET', '/api/pm/notifications/summary', 'auth', ({ user: u }) => ({ unread: myNotifications(u).filter((n) => !n.readAt).length }));
  // Mark read: { ids: [...] } (mine only; anyone else's are ignored) or { all: true }.
  route('PUT', '/api/pm/notifications/read', 'auth', ({ body, user: u }) => {
    noAudit(); // reading is not a change to the company's data
    let pick;
    if (body.all === true) pick = () => true;
    else {
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > NOTIFY_KEEP) throw new HttpError(400, `Send the notifications to mark as read (1 to ${NOTIFY_KEEP}), or all.`);
      const ids = new Set(body.ids.map(idOf).filter(Boolean));
      pick = (n) => ids.has(n.id);
    }
    const marked = markRead(u, pick);
    if (marked) db.save();
    return { marked, unread: myNotifications(u).filter((n) => !n.readAt).length };
  });
  // Also used by the bell (server/notifications.js): the same records, so reading one in either
  // place marks it read in both. The caller saves.
  function markRead(u, pick) {
    const at = now();
    let marked = 0;
    for (const n of d().pmNotifications) if (n.userId === u.id && !n.readAt && pick(n)) (n.readAt = at), marked++;
    return marked;
  }
  const notifications = {
    list: (u) => myNotifications(u),
    markRead: (u, ids) => {
      if (ids === 'all') return markRead(u, () => true);
      const set = new Set(ids.map(idOf).filter(Boolean));
      return markRead(u, (n) => set.has(n.id));
    },
  };

  // ===== Saved views of a project's Board or List =====
  // Mine (anyone who can open the project) or shared with the project (its managers). I see my own
  // and the shared ones; someone else's private view is "not found".
  const viewOut = (v, p, u) => ({ id: v.id, tab: v.tab, name: v.name, query: v.query, shared: v.userId === null, mine: v.createdBy === u.id, createdAt: v.createdAt, canDelete: v.userId === u.id || (v.userId === null && (v.createdBy === u.id || levelOf(p, u) === 'manage')) });
  const viewsOf = (p, u) => d().pmViews.filter((v) => v.projectId === p.id && (v.userId === null || v.userId === u.id));
  route('GET', '/api/pm/projects/:id/views', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    return viewsOf(p, u).sort((a, b) => Number(a.userId !== null) - Number(b.userId !== null) || a.name.localeCompare(b.name)).map((v) => viewOut(v, p, u));
  });
  route('POST', '/api/pm/projects/:id/views', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u);
    const tab = oneOf(body.tab, VIEW_TABS, 'Tab', null);
    if (!tab) throw new HttpError(400, 'Say which tab the view is for.');
    const name = str(body.name, 60);
    if (!name) throw new HttpError(400, 'Name the view.');
    const shared = bool(body.shared, 'Shared', false);
    if (shared) need(p, u, 'manage');
    if (typeof body.query !== 'string' || body.query.length > 2000) throw new HttpError(400, 'The view\'s filters are missing or too long.');
    const query = cleanViewQuery(tab, body.query);
    const userId = shared ? null : u.id;
    const same = d().pmViews.filter((v) => v.projectId === p.id && v.userId === userId);
    if (same.length >= 30) throw new HttpError(400, `${shared ? 'This project has' : 'You have'} 30 saved views; delete one first.`);
    if (same.some((v) => v.tab === tab && v.name.toLowerCase() === name.toLowerCase())) throw new HttpError(400, `There is already a view called "${name}". Pick another name, or delete that one first.`);
    const v = { id: randomUUID(), projectId: p.id, userId, createdBy: u.id, tab, name, query, createdAt: now() };
    d().pmViews.push(v);
    db.save();
    return viewOut(v, p, u);
  });
  route('DELETE', '/api/pm/projects/:id/views/:viewId', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    const v = viewsOf(p, u).find((x) => x.id === params.viewId);
    if (!v) throw new HttpError(404, 'View not found.');
    if (!viewOut(v, p, u).canDelete) throw new HttpError(403, 'Only the person who saved a shared view or a project manager can delete it.');
    d().pmViews = d().pmViews.filter((x) => x !== v);
    db.save();
    return { ok: true };
  });

  // ===== Milestones across projects, and the billing forecast =====
  // Every milestone of the projects a person can open (not templates or cancelled projects), with
  // its project, client, health, deliverable, submitted and accepted dates. Amounts (billing % of
  // the contract's value, or of the deal's without a contract) and the forecast by month are only
  // for people with Sales & CRM access: without it the fields are not sent at all.
  route('GET', '/api/pm/milestones', 'auth', ({ user: u }) => {
    const money = userCan(u, 'crm.view');
    const c = cal();
    const t0 = today();
    const rows = [];
    for (const p of visibleProjects(u).filter((x) => x.status !== 'cancelled')) {
      const ms = milestonesOf(p);
      if (!ms.length) continue;
      const st = projectStatus(p, ms, tasksOf(p), t0, c);
      const contract = p.contractId && d().crmContracts.find((x) => x.id === p.contractId);
      const deal = p.dealId && d().crmDeals.find((x) => x.id === p.dealId);
      const value = Number(contract?.value) > 0 ? Number(contract.value) : Number(deal?.value) > 0 ? Number(deal.value) : null;
      for (const m of ms) {
        const s = st.milestones.find((x) => x.id === m.id);
        const done = Boolean(m.acceptedAt) || s.finished;
        const row = {
          id: m.id, name: m.name, dueDate: m.dueDate, deliverable: Boolean(m.deliverable), billingPercent: m.deliverable ? m.billingPercent ?? null : null,
          submittedAt: m.submittedAt || null, acceptedAt: m.acceptedAt || null, finished: done, overdue: !done && m.dueDate < t0,
          health: done || p.status === 'completed' ? null : s.value, reason: done ? null : s.reasons[0] || null, progress: s.progress.percent, files: (m.attachments || []).length,
          projectId: p.id, projectCode: p.code, projectName: p.name, projectIcon: p.icon || null, projectIconImage: p.iconImage ? { at: p.iconImage.at } : null, projectStatus: p.status, accountId: p.accountId || null, accountName: accountName(p.accountId),
        };
        if (money) Object.assign(row, { amount: billingAmount(m, value), valueFrom: value == null ? null : Number(contract?.value) > 0 ? `contract ${contract.code}` : `deal ${deal.code}` });
        rows.push(row);
      }
    }
    rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.projectCode.localeCompare(b.projectCode));
    const forecast = money ? billingForecast(rows.filter((r) => r.deliverable && Number(r.billingPercent) > 0), t0) : null;
    return { today: t0, amounts: money, rows, forecast };
  });

  // ===== The daily digest =====
  // One email per person per working day (Projects setup) through the Service Desk's outgoing mail:
  // their overdue tasks, tasks due within 3 working days, milestones at risk in projects they
  // manage, and their unread For you count. Only projects the person can open. Without outgoing
  // mail, or for someone who turned it off, the same digest is on My work and nothing is sent.
  const digestSettings = () => pm().digest;
  const emailOf = (x) => {
    const emp = x?.employeeId && d().employees.find((e) => e.id === x.employeeId);
    const email = String(emp?.email || '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  };
  // The address links in the email open CORE at: where the setup was saved from, unless that was
  // this computer only (localhost), which would not open for anyone reading on another device.
  const linkOrigin = () => {
    const o = digestSettings().origin;
    if (!o) return null;
    try {
      return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(new URL(o).hostname) ? null : o;
    } catch {
      return null;
    }
  };
  function digestOf(x, day = today()) {
    const c = cal();
    const projects = d().pmProjects.filter((p) => !p.isTemplate && levelOf(p, x));
    const tasks = [];
    const milestones = [];
    for (const p of projects) {
      const all = tasksOf(p);
      for (const t of all) {
        if (t.assigneeId !== x.id || !t.dueDate || !isOpenCategory(categoryOf(p, t))) continue;
        tasks.push({ id: t.id, key: t.key, title: t.title, dueDate: t.dueDate, projectId: p.id, projectCode: p.code, projectName: p.name });
      }
      if (!OPEN_PROJECT.includes(p.status) || !p.members.some((m) => m.userId === x.id && m.role === 'manager')) continue;
      const ms = milestonesOf(p);
      const st = projectStatus(p, ms, all, day, c);
      for (const m of ms) {
        const s = st.milestones.find((y) => y.id === m.id);
        if (m.acceptedAt || s.finished) continue;
        milestones.push({ id: m.id, name: m.name, dueDate: m.dueDate, deliverable: Boolean(m.deliverable), value: s.value, reason: s.reasons[0] || '', projectId: p.id, projectCode: p.code, projectName: p.name });
      }
    }
    return digestFor({ tasks, milestones, unread: myNotifications(x).filter((n) => !n.readAt).length, today: day, cal: c });
  }
  // Whether a person's digest is emailed, and if not, why (shown on My work).
  function emailStatus(x) {
    const g = digestSettings();
    const reason = x.pmDigest === false ? 'You turned the email off. The digest is shown here only.'
      : !g.enabled ? 'Daily digest emails are turned off for the company (Projects setup), so the digest is shown here only.'
        : !mailer?.canEmail() ? 'CORE has no outgoing email set up (Service Desk settings), so the digest is shown here only.'
          : !emailOf(x) ? 'There is no email address on your employee record, so the digest is shown here only.' : null;
    return { preference: x.pmDigest !== false, emailing: !reason, reason, address: emailOf(x), time: g.time, workingDaysOnly: g.workingDaysOnly };
  }
  let digestRun = null;
  // Sends the digests that are due (called every minute; tests call it with their own clock). Each
  // person gets at most one a day: the day is marked, and saved, before the email goes, so a crash
  // or a failed send never sends it twice. A server that was off at the send time catches up later
  // the same day. Nobody is emailed without outgoing mail, an email address or an active account.
  function runDigest(at = clock()) {
    if (digestRun) return digestRun;
    digestRun = (async () => {
      const g = digestSettings();
      const day = localDate(at);
      const out = { day, sent: 0, empty: 0, failed: 0 };
      if (db.data.modules?.projects === false) return { ...out, reason: 'module off' };
      if (!digestDue(g, day, localTime(at), cal())) return { ...out, reason: 'not due' };
      if (!mailer?.canEmail()) return { ...out, reason: 'no outgoing mail' };
      const due = d().users.filter((x) => x.active && x.pmDigest !== false && g.sent[x.id] !== day && emailOf(x));
      if (!due.length) return out;
      const jobs = [];
      for (const x of due) {
        g.sent[x.id] = day;
        const dg = digestOf(x, day);
        if (dg.empty) out.empty++;
        else jobs.push({ x, dg });
      }
      db.save();
      const from = mailer.address();
      let error = null;
      for (const { x, dg } of jobs) {
        const m = digestEmail(dg, { name: x.name, company: d().settings?.companyName || '', origin: linkOrigin() });
        const raw = composeMessage({ from: { name: 'CORE Projects', email: from }, to: [{ name: x.name, email: emailOf(x) }], subject: m.subject, text: m.text, html: m.html, messageId: newMessageId(from), auto: 'generated' });
        try {
          await sendMail(mailer.smtpOptions(), { from, to: [emailOf(x)], raw });
          out.sent++;
        } catch (err) {
          out.failed++;
          error = String(err?.message || err).slice(0, 200);
        }
      }
      g.lastRun = { at: at.toISOString(), day, sent: out.sent, failed: out.failed, error };
      db.save();
      // A failure is recorded once a run (the mail server's answer, never the sign-in).
      if (out.failed) audit?.record('projects.digest-failed', { label: 'Projects daily digest', note: `${out.failed} of ${jobs.length} not sent: ${error}`, actor: { name: 'CORE' } });
      return out;
    })().finally(() => (digestRun = null));
    return digestRun;
  }
  const digestTimer = setInterval(() => runDigest().catch(() => {}), 60000);
  digestTimer.unref?.();

  // My digest (as it would be emailed today) and whether it is emailed.
  route('GET', '/api/pm/digest', 'auth', ({ user: u }) => ({ ...digestOf(u), email: emailStatus(u) }));
  // "Email me a daily digest" (on unless turned off).
  route('PUT', '/api/pm/digest/preference', 'auth', ({ body, user: u }) => {
    if (typeof body.email !== 'boolean') throw new HttpError(400, 'Say whether to email you the daily digest.');
    if (body.email) delete u.pmDigest;
    else u.pmDigest = false;
    db.save();
    return emailStatus(u);
  });

  // ===== From Sales & CRM =====
  function crmStart(kind, rec, body, u, existing) {
    if (existing && body.force !== true) throw new HttpError(409, levelOf(existing, u) ? `${existing.code} is already the project for this ${kind}. Open it, or start another one anyway.` : `A project you are not on already delivers this ${kind}. Start another one anyway, or ask its manager to add you.`);
    const acct = d().crmAccounts.find((a) => a.id === rec.accountId);
    const types = pm().types;
    const guess = acct?.sector === 'government' && types.includes('Government') ? 'Government' : types.includes('Client') ? 'Client' : types[0];
    const contract = kind === 'contract' ? rec : d().crmContracts.find((c) => c.dealId === rec.id && c.status !== 'terminated');
    const defaults = {
      name: rec.title, type: guess, description: rec.description || rec.terms || '', status: 'planning',
      startDate: contract?.startDate && contract.startDate > today() ? contract.startDate : today(), endDate: contract?.endDate || null, managerId: u.id,
      accountId: rec.accountId, dealId: kind === 'deal' ? rec.id : rec.dealId || null, contractId: contract?.id || null,
    };
    const fields = validProject({ ...defaults, ...pickFields(body, ['name', 'type', 'description', 'startDate', 'endDate', 'managerId', 'timeTracking', 'budgetHours']) }, u);
    const p = createProject(fields, u);
    db.save();
    return summaryOf(p, u);
  }
  route('POST', '/api/pm/projects/from-deal/:dealId', 'pm.edit', ({ params, body, user: u }) => {
    if (!userCan(u, 'crm.view')) throw new HttpError(403, 'Starting a project from a deal needs Sales & CRM access too.');
    const deal = d().crmDeals.find((x) => x.id === params.dealId);
    if (!deal) throw new HttpError(404, 'Deal not found.');
    if (deal.stage !== 'won') throw new HttpError(400, 'Only a won deal can start a project. Mark the deal as won first.');
    return crmStart('deal', deal, body, u, d().pmProjects.find((p) => p.dealId === deal.id));
  });
  route('POST', '/api/pm/projects/from-contract/:contractId', 'pm.edit', ({ params, body, user: u }) => {
    if (!userCan(u, 'crm.view')) throw new HttpError(403, 'Starting a project from a contract needs Sales & CRM access too.');
    const c = d().crmContracts.find((x) => x.id === params.contractId);
    if (!c) throw new HttpError(404, 'Contract not found.');
    if (c.status === 'expired' || c.status === 'terminated') throw new HttpError(400, 'This contract has ended. Start a project from an active contract.');
    return crmStart('contract', c, body, u, d().pmProjects.find((p) => p.contractId === c.id));
  });

  // ===== From the Service Desk: a ticket becomes a task (both keep a link) =====
  route('POST', '/api/pm/tasks/from-ticket/:ticketId', 'helpdesk.agent', ({ params, body, user: u }) => {
    const ticket = d().tickets.find((x) => x.id === params.ticketId);
    if (!ticket) throw new HttpError(404, 'Ticket not found.');
    const p = findProject(idOf(body.projectId), u, 'work');
    if (p.isTemplate) throw new HttpError(400, `${p.code} is a template. Pick an open project.`);
    if (!OPEN_PROJECT.includes(p.status)) throw new HttpError(400, `${p.code} is ${PROJECT_STATUS[p.status].toLowerCase()}. Pick an open project.`);
    const existing = tasksOf(p).find((t) => t.ticketId === ticket.id);
    if (existing) return { ...taskOut(existing, p, taskCtx(p)), existing: true };
    const first = ticket.messages.find((m) => m.kind !== 'event');
    const fields = validTask({ title: ticket.subject, description: `From service desk ticket ${ticket.ref}.\n\n${first?.body || ''}`.trim().slice(0, 4000), priority: ticket.priority }, p, u, levelOf(p, u));
    const t = newTask(p, u, fields, { ticketId: ticket.id, rank: nextRank(p, fields.statusId) });
    t.history[0].to = `from ticket ${ticket.ref}`;
    ticket.messages.push({ id: randomUUID(), kind: 'event', public: false, author: { userId: u.id, name: u.name, role: 'agent' }, body: `Added to project ${p.code} as task ${t.key}`, at: now(), attachments: [] });
    ticket.updatedAt = now();
    db.save();
    return taskOut(t, p, taskCtx(p));
  });

  // ===== Projects setup (pm.manage) =====
  const digestOut = () => {
    const g = digestSettings();
    return { enabled: g.enabled, time: g.time, workingDaysOnly: g.workingDaysOnly, origin: g.origin, links: Boolean(linkOrigin()), canEmail: Boolean(mailer?.canEmail()), lastRun: g.lastRun || null };
  };
  route('GET', '/api/pm/settings', 'pm.manage', () => ({ statuses: pm().statuses, types: pm().types, sizes: pm().sizes, digest: digestOut() }));
  // The daily digest: on or off, the time (HH:MM, this server's local time) and working days only.
  // Links in the email open CORE at the address this was saved from.
  route('PUT', '/api/pm/settings/digest', 'pm.manage', ({ body, origin }) => {
    const enabled = bool(body.enabled, 'Send the daily digest', false);
    const time = body.time === undefined ? digestSettings().time : body.time;
    if (!validDigestTime(time)) throw new HttpError(400, 'Enter the time as HH:MM, e.g. 07:30.');
    const workingDaysOnly = bool(body.workingDaysOnly, 'Working days only', true);
    Object.assign(digestSettings(), { enabled, time, workingDaysOnly, origin: typeof origin === 'string' && /^https?:\/\/[^\s/]+$/.test(origin) ? origin : null });
    pm().customized = true;
    db.save();
    return digestOut();
  });
  route('PUT', '/api/pm/settings', 'pm.manage', ({ body }) => {
    const statuses = validStatuses(body.statuses, pm().statuses);
    const types = [...new Set((Array.isArray(body.types) ? body.types : []).map((x) => str(x, 40)).filter(Boolean))];
    if (!types.length || types.length > 20) throw new HttpError(400, 'Keep 1 to 20 project types.');
    // The wording of the effort sizes (optional: kept when not sent). The weights never change.
    let sizes = pm().sizes;
    if (body.sizes !== undefined) {
      const r = cleanSizeNotes(body.sizes);
      if (r.problem) throw new HttpError(400, r.problem);
      sizes = r.notes;
    }
    Object.assign(pm(), { customized: true, statuses, types, sizes });
    db.save();
    return { statuses, types, sizes, digest: digestOut() };
  });

  // ===== Projects access per account (administrators), like CRM access =====
  const access = () => d().users.filter((x) => x.active).map((x) => ({
    id: x.id, name: x.name, username: x.username, role: x.role, byRole: can(x.role, 'pm.view'),
    override: typeof x.pmAccess === 'boolean' ? x.pmAccess : null, hasAccess: userCan(x, 'pm.view'), canEdit: userCan(x, 'pm.edit'),
    projects: d().pmProjects.filter((p) => p.members.some((m) => m.userId === x.id)).length,
  }));
  route('GET', '/api/pm/access', 'users.manage', access);
  route('PUT', '/api/pm/access/:userId', 'users.manage', ({ params, body }) => {
    const x = d().users.find((y) => y.id === params.userId);
    if (!x) throw new HttpError(404, 'User not found.');
    if (x.role === 'admin') throw new HttpError(400, 'Administrators always have Projects access.');
    const before = userCan(x, 'pm.edit') ? 'View and edit' : userCan(x, 'pm.view') ? 'View' : 'No';
    const overrideBefore = x.pmAccess;
    if (body.access === true || body.access === false) {
      if (body.access === (can(x.role, 'pm.view') && can(x.role, 'pm.edit'))) delete x.pmAccess;
      else x.pmAccess = body.access;
    } else if (body.access === null) delete x.pmAccess;
    else throw new HttpError(400, 'Choose whether this account can use Projects.');
    if (x.pmAccess === overrideBefore) {
      noAudit(); // nothing changed, nothing to record
      return access();
    }
    db.save();
    const after = userCan(x, 'pm.edit') ? 'View and edit' : userCan(x, 'pm.view') ? 'View' : 'No';
    audit?.record('user.update', { entity: 'user', entityId: x.id, label: `${x.name} (${x.username})`, changes: [{ field: 'Projects access', from: before, to: after }] });
    return access();
  });

  // For tests: send the digests now (with a clock), and a person's digest.
  return { runDigest, digestOf: (userId) => digestOf(user(userId)), notifications };
}
