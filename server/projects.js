// Project Management routes: projects with members, milestones (contract deliverables), tasks on
// a board, comments and time logs. Who sees a project: anyone with pm.view (every project), and
// the project's own members (manager, member or viewer), whatever their account type. Everyone
// else gets "not found", for the project and for everything in it.
// Data lives in db.data.pm* collections; the Projects setup (default statuses, project types and
// the code counter) in db.data.pm. A project marked as a template (isTemplate) is left out of the
// portfolio, My work, Workload and health; "+ New project" can start from it.
import { randomUUID } from 'node:crypto';
import { HttpError, localDate } from './util.js';
import { noAudit } from './audit.js';
import { can, userCan } from '../shared/roles.js';
import { isDate } from './crm.js';
import { computeEntry, scheduleFor, hoursPerDay } from '../shared/calc.js';
import { TICKET_STATUS, UNRESOLVED_TICKET } from '../shared/helpdesk.js';
import {
  PROJECT_STATUS, OPEN_PROJECT, CATEGORIES, PRIORITY, MEMBER_ROLES, HEALTH, STATUS_COLORS, DEFAULT_STATUSES, DEFAULT_TYPES,
  workCalendar, statusOf, categoryOf, isOpenCategory, firstStatus, statusSetProblem, taskFlags, milestoneOfTask, leafTasks,
  projectStatus, placeInColumn, byRank, makesCycle, myWorkGroup, workload, daysBetween, addDays,
  validHours, RANK_STEP, weekStart, remainingOf, validRemaining, shiftWorkDays, mentionedUsernames, cleanViewQuery, VIEW_TABS,
  NOTIFY_KEEP, NOTIFY_DAYS, milestoneBurnup,
} from '../shared/projects.js';
import { addStarterTemplates } from './pm-templates.js';

// Every collection here has a projectId, so deleting a project (or the demo data) takes its records.
// pmNotifications: "For you" on My work, one row per person and event. pmViews: saved filters of a
// project's Board or List, a person's own (userId) or shared with the project (userId null).
export const PM_COLLECTIONS = ['pmProjects', 'pmMilestones', 'pmTasks', 'pmComments', 'pmTimeLogs', 'pmNotifications', 'pmViews'];
export const emptyPm = () => ({ statuses: structuredClone(DEFAULT_STATUSES), types: [...DEFAULT_TYPES], seq: { project: 0 } });

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
    if (!pm.seq || typeof pm.seq !== 'object' || !Number.isInteger(pm.seq.project) || pm.seq.project < 0) (pm.seq = { project: 0 }), (changed = true);
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
  return changed;
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
  for (const t of db.data.pmTasks || []) if (t.assigneeId === userId) t.assigneeId = null;
  db.data.pmNotifications = (db.data.pmNotifications || []).filter((n) => n.userId !== userId);
  for (const n of db.data.pmNotifications) if (n.actorId === userId) n.actorId = null;
  db.data.pmViews = (db.data.pmViews || []).filter((v) => v.userId !== userId);
}

// The project tasks linked to a service desk ticket (shown on the ticket).
export function linkedTasks(db, ticketId) {
  return (db.data.pmTasks || []).filter((t) => t.ticketId === ticketId).map((t) => {
    const p = db.data.pmProjects.find((x) => x.id === t.projectId);
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

const PROJECT_FIELDS = ['name', 'type', 'description', 'status', 'startDate', 'endDate', 'managerId', 'budgetHours', 'accountId', 'dealId', 'contractId'];
const TASK_FIELDS = ['title', 'description', 'statusId', 'priority', 'assigneeId', 'startDate', 'dueDate', 'estimateHours', 'remainingHours', 'milestoneId', 'parentId', 'blockedBy'];
const MILESTONE_FIELDS = ['name', 'dueDate', 'deliverable', 'billingPercent', 'submittedAt', 'acceptedAt', 'acceptanceNote'];
const LEVEL = { read: 1, comment: 2, work: 3, manage: 4 };
const MAX_HISTORY = 200;

export function registerProjectRoutes(route, db, { audit } = {}) {
  const d = () => db.data;
  const pm = () => db.data.pm;
  const user = (id) => d().users.find((u) => u.id === id);
  const userName = (id) => user(id)?.name || null;
  const activeUser = (id) => d().users.find((u) => u.id === id && u.active);
  const cal = () => workCalendar(d().settings, d().holidays);
  const today = () => localDate();

  // ----- Who may do what in a project -----
  // manage: pm.edit or the project's manager; work: a member; comment: a viewer; read: pm.view.
  function levelOf(p, u) {
    const m = p.members.find((x) => x.userId === u.id);
    if (userCan(u, 'pm.edit') || m?.role === 'manager') return 'manage';
    if (m?.role === 'member') return 'work';
    if (m?.role === 'viewer') return 'comment';
    if (userCan(u, 'pm.view')) return 'read';
    return null;
  }
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
      ...rest, isTemplate: Boolean(p.isTemplate), access: levelOf(p, u), managerName: userName(p.managerId), accountName: accountName(p.accountId),
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
    const { history, ...rest } = t;
    const logged = ctx.logged.get(t.id) || 0;
    return {
      ...rest, statusName: s?.name || '', category: flags.category, overdue: flags.overdue, dueSoon: flags.dueSoon, blocked: flags.blocked, blockers: flags.blockers,
      // Hours: logged on the task, and what is left (remainingHours stays the override, or null).
      remainingHours: t.remainingHours ?? null, loggedHours: Math.round(logged * 100) / 100, remaining: remainingOf(t, logged, flags.category), remainingOverride: t.remainingHours != null,
      assigneeName: userName(t.assigneeId), subtasks: ctx.children.get(t.id) || 0, checklistDone: t.checklist.filter((i) => i.done).length,
      milestoneIdEffective: milestoneOfTask(t, ctx.byId),
      ticket: ticket ? { id: ticket.id, ref: ticket.ref, status: ticket.status, statusName: TICKET_STATUS[ticket.status] || ticket.status } : null,
    };
  }
  function taskCtx(p) {
    const tasks = tasksOf(p);
    const children = new Map();
    for (const t of tasks) if (t.parentId) children.set(t.parentId, (children.get(t.parentId) || 0) + 1);
    return { tasks, byId: new Map(tasks.map((t) => [t.id, t])), children, logged: loggedByTask(p), today: today(), cal: cal() };
  }
  // Hours logged per task of a project.
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
  // A task moved into Done or Cancelled by someone else: its assignee is told.
  function notifyStatus(t, p, u, fromId) {
    const from = statusOf(p, fromId)?.category;
    const to = statusOf(p, t.statusId);
    if (!to || from === to.category || !['done', 'cancelled'].includes(to.category)) return;
    notify([t.assigneeId], 'status', p, t, u, `moved ${t.key} to ${to.name}`);
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
      types: pm().types, statuses: pm().statuses,
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
    id: p.id, code: p.code, name: p.name, type: p.type, description: p.description, starter: p.starter || null, access: levelOf(p, u),
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
    return {
      name, type, description: str(b.description, 8000), status: oneOf(b.status, PROJECT_STATUS, 'Status', rec.status || 'planning'),
      startDate, endDate, managerId, budgetHours: optNum(b.budgetHours, 'Budget (hours)', 0, 1000000), ...crmLinks(b, u, rec),
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
    d().pmProjects.push(p);
    notifyAdded(p, u, []);
    return p;
  }
  route('POST', '/api/pm/projects', 'pm.edit', ({ body, user: u }) => {
    const p = createProject(validProject(pickFields(body, PROJECT_FIELDS), u), u);
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
    const logs = d().pmTimeLogs.filter((x) => x.projectId === p.id);
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
      milestones: milestones.map((m) => ({ ...m, ...s.milestones.find((x) => x.id === m.id), afterContract: Boolean(m.deliverable && contract?.endDate && m.dueDate > contract.endDate) })),
      // Remaining: what is left of the open leaf tasks (estimate less logged, or the hours left set on a task).
      hours: {
        estimate: Math.round(leaves.reduce((n, t) => n + (Number(t.estimateHours) || 0), 0) * 100) / 100, logged: Math.round(logs.reduce((n, x) => n + x.hours, 0) * 100) / 100,
        remaining: Math.round(leaves.reduce((n, t) => n + (remainingOf(t, ctx.logged.get(t.id) || 0, categoryOf(p, t)) || 0), 0) * 100) / 100,
      },
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
    const before = { status: p.status, startDate: p.startDate, endDate: p.endDate, managerId: p.managerId, isTemplate: Boolean(p.isTemplate), members: p.members.map((m) => m.userId) };
    const isTemplate = bool(body.isTemplate, 'Use as a template', before.isTemplate);
    Object.assign(p, validProject({ ...p, ...pickFields(body, PROJECT_FIELDS) }, u, p));
    p.isTemplate = isTemplate;
    keepManager(p);
    track(p, u, 'status', PROJECT_STATUS[before.status], PROJECT_STATUS[p.status]);
    track(p, u, 'start', before.startDate, p.startDate);
    track(p, u, 'end', before.endDate, p.endDate);
    track(p, u, 'manager', userName(before.managerId), userName(p.managerId));
    track(p, u, 'template', before.isTemplate ? 'Yes' : 'No', p.isTemplate ? 'Yes' : 'No');
    notifyAdded(p, u, before.members);
    bump(p, u);
    db.save();
    return summaryOf(p, u);
  });
  route('DELETE', '/api/pm/projects/:id', 'pm.manage', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    removeProject(p.id);
    db.save();
    return { ok: true };
  });
  function removeProject(id) {
    for (const k of PM_COLLECTIONS) d()[k] = d()[k].filter((x) => (k === 'pmProjects' ? x.id !== id : x.projectId !== id));
  }

  // Copy, or a new project from a template: the statuses, milestones (with their deliverable and
  // billing %) and tasks (subtasks, checklists unticked, blocked-by links, estimates). No people,
  // time or comments. Dates move with the start date: by the same number of days for a copy, by
  // the same number of working days (weekends and holidays skipped) from a template. The new
  // project's manager and client links can be given (CRM links need Sales & CRM access).
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
      startDate, endDate: move(src.endDate), budgetHours: src.budgetHours ?? null,
    }, u, { type: src.type });
    const p = createProject(fields, u, { statuses: structuredClone(src.statuses), copiedFrom: src.id });
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
        assigneeId: null, startDate: move(t.startDate), dueDate: move(t.dueDate), estimateHours: t.estimateHours ?? null, remainingHours: null, milestoneId: msIds.get(t.milestoneId) || null,
        parentId: taskIds.get(t.parentId) || null, checklist: t.checklist.map((c) => ({ id: randomUUID(), text: c.text, done: false })),
        blockedBy: (t.blockedBy || []).map((x) => taskIds.get(x)).filter(Boolean), ticketId: null, rank: (i + 1) * RANK_STEP, completedAt: null,
        version: 1, createdAt: now(), createdBy: u.id, updatedAt: now(), updatedBy: u.id, history: [{ at: now(), by: u.id, field: 'created', from: '', to: `copied from ${t.key}` }],
      });
    });
    db.save();
    return summaryOf(p, u);
  });

  // Members: the whole list at once. Removing someone unassigns their open tasks.
  route('PUT', '/api/pm/projects/:id/members', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    fresh(p, body);
    const list = Array.isArray(body.members) ? body.members : null;
    if (!list || list.length > 100) throw new HttpError(400, 'Send the list of members (at most 100).');
    const members = [];
    for (const m of list) {
      const userId = idOf(m?.userId);
      const role = oneOf(m?.role, MEMBER_ROLES, 'Role', 'member');
      const existing = p.members.some((x) => x.userId === userId);
      if (!userId || (!existing && !activeUser(userId))) throw new HttpError(400, 'Pick members from the list of active accounts.');
      if (members.some((x) => x.userId === userId)) throw new HttpError(400, `${userName(userId)} is on the list twice.`);
      members.push({ userId, role });
    }
    const next = { ...p, members };
    keepManager(next);
    if (!next.members.some((m) => m.role === 'manager')) throw new HttpError(400, 'Keep at least one manager on the project.');
    const gone = p.members.filter((m) => !next.members.some((x) => x.userId === m.userId)).map((m) => m.userId);
    for (const t of tasksOf(p)) if (gone.includes(t.assigneeId) && isOpenCategory(categoryOf(p, t))) {
      track(t, u, 'assignee', userName(t.assigneeId), '');
      t.assigneeId = null;
      bump(t, u);
    }
    // A member who is now a viewer keeps their tasks; they can still read and comment.
    const was = p.members.map((m) => m.userId);
    p.members = next.members;
    notifyAdded(p, u, was);
    track(p, u, 'members', '', `${p.members.length} member${p.members.length === 1 ? '' : 's'}`);
    bump(p, u);
    db.save();
    return { ...summaryOf(p, u), unassigned: gone.length };
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
    // Hours left: empty (null) means estimate less logged. A new estimate starts that count again.
    const estimateHours = optNum(b.estimateHours, 'Estimate (hours)', 0, 9999);
    let remainingHours = optNum(b.remainingHours, 'Hours left', 0, 9999);
    if (remainingHours !== null && !validRemaining(remainingHours)) throw new HttpError(400, 'Hours left must be from 0 to 9999, in quarter hours (0.25, 0.5, 0.75…).');
    if (rec.id && estimateHours !== (rec.estimateHours ?? null) && b.remainingHours === rec.remainingHours) remainingHours = null;
    return {
      title, description: str(b.description, 8000), statusId, priority: oneOf(b.priority, PRIORITY, 'Priority', rec.priority || 'normal'),
      assigneeId, startDate, dueDate, estimateHours, remainingHours, milestoneId, parentId, blockedBy,
    };
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
    const left = (v) => (v == null ? '' : `${v} h`);
    track(t, u, 'hours left', left(before.remainingHours), left(t.remainingHours));
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
    const logs = d().pmTimeLogs.filter((x) => x.taskId === t.id).sort((a, b) => b.date.localeCompare(a.date));
    const parent = t.parentId && ctx.byId.get(t.parentId);
    return {
      ...taskOut(t, p, ctx), history: historyOut(t.history || []), access: levelOf(p, u),
      project: { id: p.id, code: p.code, name: p.name, statuses: p.statuses, members: membersOut(p) },
      parent: parent ? { id: parent.id, key: parent.key, title: parent.title } : null,
      subtaskList: ctx.tasks.filter((x) => x.parentId === t.id).sort(byRank).map((x) => taskOut(x, p, ctx)),
      blockedByList: t.blockedBy.map((id) => ctx.byId.get(id)).filter(Boolean).map((x) => taskOut(x, p, ctx)),
      blocking: ctx.tasks.filter((x) => x.blockedBy.includes(t.id)).map((x) => ({ id: x.id, key: x.key, title: x.title })),
      // The rest of the project, for the parent and blocked-by pickers.
      others: ctx.tasks.filter((x) => x.id !== t.id).sort(byRank).map((x) => ({ id: x.id, key: x.key, title: x.title, parentId: x.parentId })),
      milestones: milestonesOf(p).map((m) => ({ id: m.id, name: m.name, dueDate: m.dueDate })),
      time: logs.map((x) => ({ ...x, userName: userName(x.userId) })), loggedHours: Math.round(logs.reduce((n, x) => n + x.hours, 0) * 100) / 100,
    };
  });
  route('PUT', '/api/pm/tasks/:id', 'auth', ({ params, body, user: u }) => {
    const { t, p } = findTask(params.id, u, 'work');
    fresh(t, body);
    const before = { ...t };
    Object.assign(t, validTask({ ...t, ...pickFields(body, TASK_FIELDS) }, p, u, levelOf(p, u), t));
    if (before.statusId !== t.statusId) t.rank = nextRank(p, t.statusId);
    addAssignee(p, t);
    setCompleted(t, p);
    trackTask(t, p, u, before);
    if (t.assigneeId !== before.assigneeId) notify([t.assigneeId], 'assigned', p, t, u, `assigned you ${t.key} ${t.title}`);
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
  // Deleting a task: its subtasks and comments go with it; time logged on it stays on the project.
  route('DELETE', '/api/pm/tasks/:id', 'auth', ({ params, user: u }) => {
    const { t, p } = findTask(params.id, u, 'work');
    if (levelOf(p, u) !== 'manage' && t.createdBy !== u.id) throw new HttpError(403, 'Only the person who added the task or a project manager can delete it.');
    const ids = new Set([t.id, ...tasksOf(p).filter((x) => x.parentId === t.id).map((x) => x.id)]);
    d().pmTasks = d().pmTasks.filter((x) => !ids.has(x.id));
    for (const x of tasksOf(p)) if (x.blockedBy.some((id) => ids.has(id))) x.blockedBy = x.blockedBy.filter((id) => !ids.has(id));
    d().pmComments = d().pmComments.filter((c) => !ids.has(c.taskId));
    d().pmNotifications = d().pmNotifications.filter((n) => !ids.has(n.taskId));
    for (const l of d().pmTimeLogs) if (ids.has(l.taskId)) l.taskId = null;
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
    notify([t.assigneeId, t.createdBy].filter((id) => !mentioned.includes(id)), 'commented', p, t, u, `commented on ${t.key}: ${quote(text)}`);
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

  // ===== Time =====
  // Hours a person attended on a day, from the DTR (null when CORE cannot tell: no linked
  // employee record, or still clocked in).
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
  route('GET', '/api/pm/projects/:id/time', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    const logs = d().pmTimeLogs.filter((x) => x.projectId === p.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const cache = new Map();
    const sum = (list) => Math.round(list.reduce((n, x) => n + x.hours, 0) * 100) / 100;
    const people = [...new Set(logs.map((x) => x.userId))].map((id) => ({ userId: id, name: userName(id) || 'Former user', hours: sum(logs.filter((x) => x.userId === id)) })).sort((a, b) => b.hours - a.hours);
    const tasks = tasksOf(p);
    const byTask = tasks.map((t) => {
      const hours = sum(logs.filter((x) => x.taskId === t.id));
      return { taskId: t.id, key: t.key, title: t.title, estimate: t.estimateHours ?? null, hours, left: remainingOf(t, hours, categoryOf(p, t)) };
    }).filter((x) => x.hours || x.estimate);
    const noTask = sum(logs.filter((x) => !x.taskId));
    const week = weekStart(today());
    return {
      entries: logs.slice(0, 500).map((x) => timeOut(x, u, p, cache)),
      mine: logs.filter((x) => x.userId === u.id && x.date >= week).map((x) => timeOut(x, u, p, cache)),
      byPerson: people, byTask: byTask.sort((a, b) => b.hours - a.hours), noTask,
      total: sum(logs), estimate: Math.round(leafTasks(tasks, p).reduce((n, t) => n + (Number(t.estimateHours) || 0), 0) * 100) / 100,
      tasks: tasks.filter((t) => isOpenCategory(categoryOf(p, t)) || logs.some((x) => x.taskId === t.id)).sort(byRank).map((t) => ({ id: t.id, key: t.key, title: t.title })),
    };
  });
  route('POST', '/api/pm/projects/:id/time', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'work');
    const date = optDate(body.date, 'Date');
    if (!date) throw new HttpError(400, 'Pick the date.');
    if (date > today()) throw new HttpError(400, 'Time can be logged for today or earlier.');
    const hours = typeof body.hours === 'number' ? body.hours : typeof body.hours === 'string' && /^\d+(\.\d+)?$/.test(body.hours.trim()) ? Number(body.hours) : NaN;
    if (!validHours(hours)) throw new HttpError(400, 'Hours must be from 0.25 to 24, in quarter hours (0.25, 0.5, 0.75…).');
    const taskId = idOf(body.taskId) || null;
    const task = taskId && d().pmTasks.find((t) => t.id === taskId && t.projectId === p.id);
    if (taskId && !task) throw new HttpError(400, 'Pick a task of this project.');
    if (loggedOn(u.id, date) + hours > 24) throw new HttpError(400, 'That would be more than 24 hours logged on one day.');
    // "Hours left after this" (optional) sets the task's hours left, as on the task.
    const left = optNum(body.remainingHours, 'Hours left', 0, 9999);
    if (left !== null && !task) throw new HttpError(400, 'Hours left is for time logged on a task.');
    if (left !== null && !validRemaining(left)) throw new HttpError(400, 'Hours left must be from 0 to 9999, in quarter hours (0.25, 0.5, 0.75…).');
    const x = { id: randomUUID(), projectId: p.id, taskId, userId: u.id, date, hours, note: str(body.note, 500), createdAt: now() };
    d().pmTimeLogs.push(x);
    if (left !== null && left !== task.remainingHours) {
      track(task, u, 'hours left', task.remainingHours == null ? '' : `${task.remainingHours} h`, `${left} h`);
      task.remainingHours = left;
      bump(task, u);
    }
    db.save();
    const out = timeOut(x, u, p, new Map());
    return { ...out, warning: out.overAttended ? `You have logged ${out.dayTotal} h on ${date}, more than the ${out.attended} h your attendance shows. It is saved; check the DTR or your entries.` : null };
  });
  route('DELETE', '/api/pm/projects/:id/time/:entryId', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    const x = d().pmTimeLogs.find((y) => y.id === params.entryId && y.projectId === p.id);
    if (!x) throw new HttpError(404, 'Time entry not found.');
    if (x.userId !== u.id && levelOf(p, u) !== 'manage') throw new HttpError(403, 'You can delete your own time entries only.');
    d().pmTimeLogs = d().pmTimeLogs.filter((y) => y !== x);
    db.save();
    return { ok: true };
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
      groups[myWorkGroup(t, t0)].push({ ...taskOut(t, p, ctxs.get(p.id)), project: { id: p.id, code: p.code, name: p.name, statuses: p.statuses }, access: levelOf(p, u) });
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
        id: n.id, kind: n.kind, text: n.text, at: n.at, readAt: n.readAt, actorName: userName(n.actorId) || 'Someone',
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
    const at = now();
    let marked = 0;
    for (const n of d().pmNotifications) if (n.userId === u.id && !n.readAt && pick(n)) (n.readAt = at), marked++;
    if (marked) db.save();
    return { marked, unread: myNotifications(u).filter((n) => !n.readAt).length };
  });

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

  // ===== Workload: planned hours against capacity, per person and week =====
  route('GET', '/api/pm/workload', 'pm.view', ({ query }) => {
    const from = isDate(query.from) ? query.from : today();
    const weeks = Math.min(26, Math.max(1, Math.round(Number(query.weeks)) || 6));
    const c = cal();
    const open = d().pmProjects.filter((p) => OPEN_PROJECT.includes(p.status) && !p.isTemplate);
    // What is left of each task is planned, not its whole estimate.
    const tasks = open.flatMap((p) => {
      const logged = loggedByTask(p);
      return tasksOf(p).filter((t) => t.assigneeId && isOpenCategory(categoryOf(p, t))).map((t) => ({
        id: t.id, key: t.key, title: t.title, projectId: p.id, projectCode: p.code, projectName: p.name, assigneeId: t.assigneeId,
        estimateHours: t.estimateHours, remaining: remainingOf(t, logged.get(t.id) || 0, categoryOf(p, t)) ?? 0, startDate: t.startDate, dueDate: t.dueDate,
      }));
    });
    const ids = new Set([...tasks.map((t) => t.assigneeId), ...open.flatMap((p) => p.members.filter((m) => m.role !== 'viewer').map((m) => m.userId))]);
    const end = addDays(weekStart(from), weeks * 7);
    const people = [...ids].map(user).filter((x) => x?.active).map((x) => {
      const emp = d().employees.find((e) => e.id === x.employeeId);
      const leave = new Map();
      if (emp) {
        for (const e of d().timeEntries) {
          if (e.employeeId !== emp.id || e.date < weekStart(from) || e.date >= end) continue;
          if (e.type === 'leave') leave.set(e.date, 1);
          else if (e.halfLeave) leave.set(e.date, Math.max(leave.get(e.date) || 0, 0.5));
        }
      }
      const schedule = emp ? scheduleFor(emp, d().settings) : null;
      return { id: x.id, name: x.name, workDays: schedule?.workDays, hoursPerDay: schedule ? hoursPerDay(schedule) : undefined, leave, leaveDays: [...leave.values()].reduce((n, v) => n + v, 0) };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return workload({ people, tasks, from, weeks, cal: c });
  });

  // ===== From Sales & CRM =====
  function crmStart(kind, rec, body, u, existing) {
    if (existing && body.force !== true) throw new HttpError(409, `${existing.code} is already the project for this ${kind}. Open it, or start another one anyway.`);
    const acct = d().crmAccounts.find((a) => a.id === rec.accountId);
    const types = pm().types;
    const guess = acct?.sector === 'government' && types.includes('Government') ? 'Government' : types.includes('Client') ? 'Client' : types[0];
    const contract = kind === 'contract' ? rec : d().crmContracts.find((c) => c.dealId === rec.id && c.status !== 'terminated');
    const defaults = {
      name: rec.title, type: guess, description: rec.description || rec.terms || '', status: 'planning',
      startDate: contract?.startDate && contract.startDate > today() ? contract.startDate : today(), endDate: contract?.endDate || null, managerId: u.id,
      accountId: rec.accountId, dealId: kind === 'deal' ? rec.id : rec.dealId || null, contractId: contract?.id || null,
    };
    const fields = validProject({ ...defaults, ...pickFields(body, ['name', 'type', 'description', 'startDate', 'endDate', 'managerId', 'budgetHours']) }, u);
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
  route('GET', '/api/pm/settings', 'pm.manage', () => ({ statuses: pm().statuses, types: pm().types }));
  route('PUT', '/api/pm/settings', 'pm.manage', ({ body }) => {
    const statuses = validStatuses(body.statuses, pm().statuses);
    const types = [...new Set((Array.isArray(body.types) ? body.types : []).map((x) => str(x, 40)).filter(Boolean))];
    if (!types.length || types.length > 20) throw new HttpError(400, 'Keep 1 to 20 project types.');
    Object.assign(pm(), { customized: true, statuses, types });
    db.save();
    return { statuses, types };
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
}
