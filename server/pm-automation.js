// Project automations: recurring tasks and the run log (0.61), automation rules (0.62).
//
// Recurring tasks: a project's managers set up a task that CORE makes on a schedule (every working
// day, every week on Monday, the last working day of the month… see shared/pm-recurring.js). Each
// one keeps the next day it is due (nextOn) in the database: a minute timer makes the tasks that
// are due and moves nextOn on in the same step, before saving, so a restart neither loses a day nor
// makes a task twice. A server that was off for some days makes one task for the latest day it
// missed, not one per day. Nothing is made for a template or for a project that is not open
// (Planning, Active); the days pass without a task. "Skip while the last one is open" (on unless
// turned off) makes nothing while the previous task is still open.
//
// The run log (pmRuns): one line each time an automation ran, made a task, skipped or failed; the
// project's newest 200 for 90 days. A failure is also sent to the project's managers (For you) and
// recorded in the audit log.
//
// Automation rules (0.62): "When a task … If … Then …" (shared/pm-rules.js). server/projects.js
// calls fire() after each change to a task (added, moved, assigned, commented on; a parent whose
// last subtask closed); a minute timer finds tasks that became overdue. The matching rules run
// their actions as CORE, at once, saved with the change that set them off. A rule's own changes can
// set off other rules, at most MAX_DEPTH steps deep, and a rule runs at most once per task for one
// change: a loop stops there and says so in the run log.
//
// Called from registerProjectRoutes (server/projects.js) with its helpers (`h`).
import { randomUUID } from 'node:crypto';
import { HttpError, localDate } from './util.js';
import { cleanSchedule, nextOccurrence, upcoming, describeSchedule, MAX_DUE_IN, MAX_RECURRING } from '../shared/pm-recurring.js';
import { cleanRule, matches, describeRule, MAX_RULES, MAX_DEPTH, WHO } from '../shared/pm-rules.js';
import { PRIORITY, PROJECT_STATUS, statusOf, firstStatus, categoryOf, isOpenCategory, addDays, addWorkDays, isSize, SIZE_KEYS } from '../shared/projects.js';

export const RUNS_KEEP = 200; // per project
export const RUNS_DAYS = 90;
const str = (v, max = 200) => (v == null || typeof v === 'object' ? '' : String(v)).trim().slice(0, max);
const now = () => new Date().toISOString();
// CORE itself, as the one who made a task: no account (history shows "CORE").
export const SYSTEM = Object.freeze({ id: null, name: 'CORE', system: true });

// The run log, newest kept: 90 days, and each project's newest 200.
export function pruneRuns(list, nowMs = Date.now()) {
  const cutoff = new Date(nowMs - RUNS_DAYS * 86400000).toISOString();
  const kept = list.filter((x) => x.at >= cutoff);
  const per = new Map();
  for (const x of kept) per.set(x.projectId, (per.get(x.projectId) || 0) + 1);
  if (![...per.values()].some((n) => n > RUNS_KEEP)) return kept.length === list.length ? list : kept;
  const drop = new Set();
  for (const [pid, n] of per) if (n > RUNS_KEEP) kept.filter((x) => x.projectId === pid).sort((a, b) => a.at.localeCompare(b.at)).slice(0, n - RUNS_KEEP).forEach((x) => drop.add(x));
  return kept.filter((x) => !drop.has(x));
}

export function registerPmAutomation(route, db, h) {
  const { findProject, levelOf, newTask, notify, activeUser, userName, cal, clock, audit, tasksOf, nextRank, bump, track, setCompleted, notifyStatus, statusChanged, autoWatch, watchersOf, canOpen, quote, milestonesOf } = h;
  const d = () => db.data;
  const today = (at = clock()) => localDate(at);
  const projectOpen = (p) => !p.isTemplate && ['planning', 'active'].includes(p.status); // not On hold, Completed or Cancelled

  // ----- The run log -----
  function logRun(p, entry, at = clock()) {
    const row = { id: randomUUID(), projectId: p.id, at: at.toISOString(), ...entry };
    d().pmRuns.push(row);
    d().pmRuns = pruneRuns(d().pmRuns, at.getTime());
    return row;
  }
  const runOut = (x) => {
    const t = x.taskId && d().pmTasks.find((y) => y.id === x.taskId);
    return { id: x.id, kind: x.kind, sourceId: x.sourceId, name: x.name, at: x.at, day: x.day || null, result: x.result, note: x.note || '', byName: x.by ? userName(x.by) || 'Former user' : 'CORE', taskId: t ? t.id : null, taskKey: t?.key || x.taskKey || null, taskTitle: t?.title || null };
  };
  // A failure: the project's managers hear of it (For you), and it goes in the audit log.
  function alertManagers(p, text) {
    const managers = p.members.filter((m) => m.role === 'manager').map((m) => m.userId);
    notify([...managers, p.managerId], 'automation', p, null, SYSTEM, text);
    audit?.record('projects.automation-failed', { entity: 'project', entityId: p.id, label: `${p.code} ${p.name}`, note: text, actor: { name: 'CORE' } });
  }

  // ----- Recurring tasks -----
  const recurringOf = (p) => d().pmRecurring.filter((r) => r.projectId === p.id);
  function findRecurring(p, id) {
    const r = d().pmRecurring.find((x) => x.id === id && x.projectId === p.id);
    if (!r) throw new HttpError(404, 'That recurring task is not in this project any more.');
    return r;
  }
  // The next day a task is due, counted from today (never a day already made).
  function scheduleNext(r, day = today()) {
    const after = [addDays(day, -1), r.lastOn || ''].sort().pop();
    r.nextOn = nextOccurrence(r.schedule, after, cal());
  }
  // Can this person be given the made tasks? A member (not a viewer) with an active account.
  const assignable = (p, id) => Boolean(id && activeUser(id) && p.members.some((m) => m.userId === id && m.role !== 'viewer'));

  function validRecurring(b, p, rec = {}) {
    const title = str(b.title, 200);
    if (!title) throw new HttpError(400, 'Give the task a title.');
    const s = cleanSchedule(b.schedule);
    if (s.error) throw new HttpError(400, s.error);
    const assigneeId = typeof b.assigneeId === 'string' && b.assigneeId ? b.assigneeId : null;
    if (assigneeId && assigneeId !== rec.assigneeId && !assignable(p, assigneeId)) throw new HttpError(400, 'Pick the assignee from the project\'s members (not its viewers).');
    const statusId = typeof b.statusId === 'string' && b.statusId ? b.statusId : null;
    if (statusId && !statusOf(p, statusId)) throw new HttpError(400, 'Pick a status from this project.');
    const priority = b.priority == null || b.priority === '' ? 'normal' : b.priority;
    if (!Object.hasOwn(PRIORITY, priority)) throw new HttpError(400, `Priority: pick ${Object.keys(PRIORITY).join(', ')}.`);
    const size = b.size == null || b.size === '' ? null : b.size;
    if (size !== null && !isSize(size)) throw new HttpError(400, `Size: pick ${SIZE_KEYS.join(', ')} or none.`);
    const dueIn = b.dueIn == null || b.dueIn === '' ? null : Number(b.dueIn);
    if (dueIn !== null && (!Number.isInteger(dueIn) || dueIn < 0 || dueIn > MAX_DUE_IN)) throw new HttpError(400, `Due: 0 to ${MAX_DUE_IN} working days after the task is made, or no due date.`);
    const rawList = b.checklist == null ? [] : b.checklist;
    if (!Array.isArray(rawList) || rawList.length > 50) throw new HttpError(400, 'A checklist has at most 50 items.');
    const checklist = rawList.map((x) => str(typeof x === 'object' && x ? x.text : x, 300)).filter(Boolean);
    return {
      title, description: str(b.description, 8000), schedule: s.schedule, assigneeId, statusId, priority, size, dueIn, checklist,
      skipIfOpen: b.skipIfOpen !== false, active: b.active !== false,
    };
  }
  function recurringOut(r, p, day = today()) {
    const last = r.lastTaskId && d().pmTasks.find((t) => t.id === r.lastTaskId);
    const s = r.statusId && statusOf(p, r.statusId);
    return {
      id: r.id, title: r.title, description: r.description, priority: r.priority, size: r.size, dueIn: r.dueIn, checklist: r.checklist,
      assigneeId: r.assigneeId, assigneeName: r.assigneeId ? userName(r.assigneeId) || 'Former user' : null, assigneeOk: !r.assigneeId || assignable(p, r.assigneeId),
      statusId: r.statusId, statusName: s ? s.name : firstStatus(p.statuses, 'todo').name,
      schedule: r.schedule, scheduleText: describeSchedule(r.schedule), active: r.active, skipIfOpen: r.skipIfOpen,
      nextOn: r.active ? r.nextOn : null, ended: r.active && !r.nextOn, lastOn: r.lastOn || null,
      upcoming: r.active ? upcoming(r.schedule, r.nextOn && r.nextOn > day ? r.nextOn : day, 3, cal()).filter((x) => x > (r.lastOn || '')) : [],
      lastTask: last ? { id: last.id, key: last.key, title: last.title, open: isOpenCategory(categoryOf(p, last)) } : null,
      made: r.made || 0, createdByName: userName(r.createdBy) || 'Former user', createdAt: r.createdAt, version: r.version,
    };
  }

  // Makes the task of a recurring task for `day` (its start date). by: who asked ("Make one now"),
  // or SYSTEM. Returns the task and what was worth noting.
  function makeTask(r, p, day, by = SYSTEM) {
    const notes = [];
    let statusId = r.statusId;
    if (statusId && !statusOf(p, statusId)) {
      notes.push('its status is no longer in the project, so it went in the first To do column');
      statusId = null;
    }
    statusId ||= firstStatus(p.statuses, 'todo').id;
    let assigneeId = r.assigneeId;
    if (assigneeId && !assignable(p, assigneeId)) {
      notes.push(`${userName(assigneeId) || 'its assignee'} is no longer a member who can take tasks, so it is unassigned`);
      assigneeId = null;
    }
    const fields = {
      title: r.title, description: r.description, statusId, priority: r.priority, assigneeId, startDate: day,
      dueDate: r.dueIn == null ? null : addWorkDays(day, r.dueIn, cal()), size: r.size, milestoneId: null, parentId: null, blockedBy: [],
    };
    const t = newTask(p, by, fields, {
      checklist: r.checklist.map((text) => ({ id: randomUUID(), text, done: false })), rank: nextRank(p, statusId), recurringId: r.id,
    });
    t.history[0].to = `repeats: ${r.title}`;
    notify([t.assigneeId], 'assigned', p, t, by, `assigned you ${t.key} ${t.title}`);
    r.lastTaskId = t.id;
    r.made = (r.made || 0) + 1;
    fire('created', t, p, by);
    if (t.assigneeId) fire('assigned', t, p, by);
    return { t, note: notes.length ? `Made, but ${notes.join('; ')}.` : '' };
  }

  // One recurring task, if it is due on `day`. Returns what happened (null: nothing due).
  function runOne(r, p, day, at) {
    if (!r.active || !r.nextOn || r.nextOn > day || p.isTemplate) return null;
    // The latest due day not yet made (a server that was off makes one task, not one per day).
    let due = r.nextOn;
    let missed = 0;
    for (let n = nextOccurrence(r.schedule, due, cal()); n && n <= day && missed < 400; n = nextOccurrence(r.schedule, due, cal())) (due = n), missed++;
    r.lastOn = due;
    scheduleNext(r, day);
    const base = { kind: 'recurring', sourceId: r.id, name: r.title, day: due };
    if (!projectOpen(p)) return null; // the day passes: nothing is made while the project is not open
    const last = r.lastTaskId && d().pmTasks.find((t) => t.id === r.lastTaskId);
    if (r.skipIfOpen && last && isOpenCategory(categoryOf(p, last))) {
      return logRun(p, { ...base, result: 'skipped', taskId: last.id, taskKey: last.key, note: 'The task made last time is still open.' }, at);
    }
    try {
      const { t, note } = makeTask(r, p, due);
      const late = missed ? `${missed} earlier day${missed === 1 ? ' was' : 's were'} missed while CORE was off; one task was made for the latest. ` : '';
      return logRun(p, { ...base, result: note ? 'warning' : 'done', taskId: t.id, taskKey: t.key, note: `${late}${note}`.trim() }, at);
    } catch (err) {
      const reason = String(err?.message || err).slice(0, 200);
      alertManagers(p, `could not make the recurring task “${str(r.title, 60)}”: ${reason}`);
      return logRun(p, { ...base, result: 'failed', note: reason }, at);
    }
  }
  // Every recurring task that is due (called every minute; tests call it with their own clock).
  function runRecurring(at = clock()) {
    const out = { day: today(at), made: 0, skipped: 0, failed: 0 };
    if (d().modules?.projects === false) return { ...out, reason: 'module off' };
    let changed = false;
    for (const r of [...d().pmRecurring]) {
      const p = d().pmProjects.find((x) => x.id === r.projectId);
      if (!p) continue;
      const before = r.nextOn;
      const run = runOne(r, p, out.day, at);
      if (run || r.nextOn !== before) changed = true;
      if (run?.result === 'done' || run?.result === 'warning') out.made++;
      else if (run?.result === 'skipped') out.skipped++;
      else if (run?.result === 'failed') out.failed++;
    }
    if (changed) db.save();
    return out;
  }
  const timer = setInterval(() => {
    try {
      runRecurring();
    } catch {} // a bad record must not stop the timer; the next minute tries again
    try {
      runOverdue();
    } catch {}
  }, 60000);
  timer.unref?.();

  // ----- Routes -----
  // The Automations tab: recurring tasks and the run log (anyone who can open the project reads
  // them; managers change them). The calendar is for the form's "next dates".
  route('GET', '/api/pm/projects/:id/automations', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u);
    const day = today();
    const c = cal();
    return {
      recurring: recurringOf(p).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => recurringOut(r, p, day)),
      rules: rulesOf(p).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => ruleOut(r, p)),
      milestones: milestonesOf(p).map((m) => ({ id: m.id, name: m.name })), maxRules: MAX_RULES,
      runs: d().pmRuns.filter((x) => x.projectId === p.id).sort((a, b) => b.at.localeCompare(a.at)).map(runOut),
      canManage: levelOf(p, u) === 'manage', open: projectOpen(p), projectStatus: PROJECT_STATUS[p.status] || p.status, today: day,
      calendar: { workDays: c.workDays, off: [...c.off].filter((x) => x >= addDays(day, -40)).sort() },
      max: MAX_RECURRING,
    };
  });
  route('POST', '/api/pm/projects/:id/recurring', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    if (recurringOf(p).length >= MAX_RECURRING) throw new HttpError(400, `A project can have up to ${MAX_RECURRING} recurring tasks. Delete one you no longer need first.`);
    const at = now();
    const r = { id: randomUUID(), projectId: p.id, ...validRecurring(body || {}, p), nextOn: null, lastOn: null, lastTaskId: null, made: 0, version: 1, createdAt: at, createdBy: u.id, updatedAt: at, updatedBy: u.id };
    scheduleNext(r);
    d().pmRecurring.push(r);
    const run = runOne(r, p, today(), clock()); // due today: made now, not in a minute
    db.save();
    return { ...recurringOut(r, p), madeTask: run?.taskId ? runOut(run) : null };
  });
  route('PUT', '/api/pm/projects/:id/recurring/:rid', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    const r = findRecurring(p, params.rid);
    if (body?.version != null && body.version !== r.version) throw new HttpError(409, `This recurring task was changed by ${userName(r.updatedBy) || 'someone else'} since you opened it. Close the form, reload, and make your change again.`);
    // Pause or resume only, or the whole form.
    const onlyActive = body && Object.keys(body).every((k) => ['active', 'version'].includes(k));
    if (onlyActive && typeof body.active !== 'boolean') throw new HttpError(400, 'Say whether the recurring task is on.');
    Object.assign(r, onlyActive ? { active: body.active } : validRecurring({ ...body }, p, r));
    scheduleNext(r);
    bump(r, u);
    const run = runOne(r, p, today(), clock());
    db.save();
    return { ...recurringOut(r, p), madeTask: run?.taskId ? runOut(run) : null };
  });
  route('DELETE', '/api/pm/projects/:id/recurring/:rid', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    const r = findRecurring(p, params.rid);
    d().pmRecurring = d().pmRecurring.filter((x) => x !== r);
    db.save();
    return { ok: true };
  });
  // "Make one now": a task today, whatever the schedule. Today's scheduled one, if still to come,
  // is then not made again.
  route('POST', '/api/pm/projects/:id/recurring/:rid/run', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    const r = findRecurring(p, params.rid);
    if (p.isTemplate) throw new HttpError(400, 'A template is a pattern: its recurring tasks start once a project is made from it.');
    const day = today();
    const { t, note } = makeTask(r, p, day, u);
    if (r.lastOn !== day && r.active && r.nextOn === day) r.lastOn = day;
    scheduleNext(r, day);
    const run = logRun(p, { kind: 'recurring', sourceId: r.id, name: r.title, day, by: u.id, result: note ? 'warning' : 'done', taskId: t.id, taskKey: t.key, note: `Made by hand. ${note}`.trim() });
    db.save();
    return { ...recurringOut(r, p), madeTask: runOut(run) };
  });

  // Copying a project (or a new one from a template) brings its recurring tasks, without
  // assignees, starting from the new project's start date (moved like its other dates).
  function copyRecurring(src, p, move, u) {
    for (const r of recurringOf(src)) {
      const start = move(r.schedule.start) || p.startDate;
      const until = r.schedule.until ? move(r.schedule.until) : null;
      const at = now();
      const copy = {
        ...structuredClone(r), id: randomUUID(), projectId: p.id, assigneeId: null, schedule: { ...r.schedule, start, until: until && until >= start ? until : null },
        lastOn: null, lastTaskId: null, made: 0, version: 1, createdAt: at, createdBy: u.id, updatedAt: at, updatedBy: u.id,
      };
      scheduleNext(copy);
      d().pmRecurring.push(copy);
    }
  }

  // ===== Automation rules (0.62) =====
  const rulesOf = (p) => d().pmRules.filter((r) => r.projectId === p.id);
  function findRule(p, id) {
    const r = d().pmRules.find((x) => x.id === id && x.projectId === p.id);
    if (!r) throw new HttpError(404, 'That rule is not in this project any more.');
    return r;
  }
  // What the form may name: this project's statuses, members and milestones.
  const ruleCtx = (p) => ({
    statuses: p.statuses, takers: p.members.filter((m) => m.role !== 'viewer').map((m) => m.userId), members: p.members.map((m) => m.userId),
    milestones: milestonesOf(p).map((m) => m.id),
  });
  const names = (p) => ({ person: (id) => userName(id) || 'a former user', milestone: (id) => milestonesOf(p).find((m) => m.id === id)?.name || 'a removed milestone' });
  function ruleOut(r, p) {
    return { id: r.id, name: r.name, active: r.active, when: r.when, conditions: r.conditions, actions: r.actions, text: describeRule(r, p, names(p)), runs: r.runs || 0, lastRunAt: r.lastRunAt || null, createdByName: userName(r.createdBy) || 'Former user', createdAt: r.createdAt, version: r.version };
  }

  // Someone a rule names: a member who can take tasks (or null), from a person or WHO.
  function who(to, t, p, u) {
    const id = to === 'creator' ? t.createdBy : to === 'manager' ? p.managerId : to === 'actor' ? u?.id : to;
    return id || null;
  }
  const label = (to, id) => (WHO[to] ? `${WHO[to].toLowerCase()} (${userName(id) || 'nobody'})` : userName(id) || 'a former user');
  const todayOf = () => localDate(clock());

  // One action on a task. Returns what was done, in a few words, or what stopped it.
  function act(a, t, p, u, r) {
    const st = (id) => statusOf(p, id)?.name || '';
    if (a.type === 'status') {
      if (!statusOf(p, a.statusId)) return 'Not moved: that status is no longer in the project';
      if (t.statusId === a.statusId) return `Already in ${st(a.statusId)}`;
      const from = t.statusId;
      t.statusId = a.statusId;
      t.rank = nextRank(p, t.statusId);
      setCompleted(t, p);
      track(t, SYSTEM, 'status', st(from), st(t.statusId));
      notifyStatus(t, p, SYSTEM, from);
      bump(t, SYSTEM);
      statusChanged(t, p, SYSTEM, from);
      return `Moved to ${st(t.statusId)}`;
    }
    if (a.type === 'assign') {
      const id = a.to === 'none' ? null : who(a.to, t, p, u);
      if (a.to !== 'none' && !assignable(p, id)) return `Not assigned: ${label(a.to, id)} is not a member who can take tasks`;
      if (t.assigneeId === id) return id ? `Already assigned to ${userName(id)}` : 'Already unassigned';
      const before = t.assigneeId;
      t.assigneeId = id;
      track(t, SYSTEM, 'assignee', userName(before), userName(id));
      bump(t, SYSTEM);
      if (!id) return 'Unassigned';
      autoWatch(t, [id], { force: true });
      notify([id], 'assigned', p, t, SYSTEM, `assigned you ${t.key} ${t.title}`);
      fire('assigned', t, p, SYSTEM);
      return `Assigned to ${userName(id)}`;
    }
    if (a.type === 'priority') {
      if (t.priority === a.priority) return `Already ${PRIORITY[a.priority]} priority`;
      track(t, SYSTEM, 'priority', PRIORITY[t.priority], PRIORITY[a.priority]);
      t.priority = a.priority;
      bump(t, SYSTEM);
      return `Priority ${PRIORITY[a.priority]}`;
    }
    if (a.type === 'due') {
      const due = addWorkDays(todayOf(), a.days, cal());
      if (t.dueDate === due) return `Already due ${due}`;
      track(t, SYSTEM, 'due', t.dueDate, due);
      t.dueDate = due;
      if (t.startDate && t.startDate > due) (track(t, SYSTEM, 'start', t.startDate, due), (t.startDate = due));
      bump(t, SYSTEM);
      return `Due ${due}`;
    }
    if (a.type === 'watch') {
      const id = who(a.to, t, p, u);
      if (!id || !canOpen(p, id)) return `No watcher added: ${label(a.to, id)} cannot open the project`;
      if (watchersOf(t).includes(id)) return `${userName(id)} already watches it`;
      autoWatch(t, [id], { force: true });
      return `${userName(id)} watches it`;
    }
    if (a.type === 'notify') {
      const ids = a.to === 'assignee' ? [t.assigneeId] : a.to === 'watchers' ? watchersOf(t) : a.to === 'creator' ? [t.createdBy]
        : a.to === 'managers' ? [...p.members.filter((m) => m.role === 'manager').map((m) => m.userId), p.managerId] : [a.to];
      const to = [...new Set(ids.filter(Boolean))].filter((id) => canOpen(p, id));
      if (!to.length) return 'Nobody to notify';
      notify(to, 'rule', p, t, SYSTEM, `about ${t.key}: ${a.text}`);
      return `Notified ${to.map((id) => userName(id)).join(', ')}`;
    }
    if (a.type === 'comment') {
      d().pmComments.push({ id: randomUUID(), taskId: t.id, projectId: p.id, userId: null, system: true, ruleId: r.id, body: a.text, createdAt: now() });
      notify([t.assigneeId, ...watchersOf(t)], 'commented', p, t, SYSTEM, `commented on ${t.key}: ${quote(a.text)}`);
      return 'Commented';
    }
    if (a.type === 'checklist') {
      const room = 50 - t.checklist.length;
      if (room <= 0) return 'No checklist items added: the checklist is full (50)';
      const items = a.items.slice(0, room);
      t.checklist.push(...items.map((text) => ({ id: randomUUID(), text, done: false })));
      bump(t, SYSTEM);
      return `${items.length} checklist item${items.length === 1 ? '' : 's'} added`;
    }
    if (a.type === 'task') {
      let assigneeId = a.to ? who(a.to, t, p, u) : null;
      let note = '';
      if (assigneeId && !assignable(p, assigneeId)) (note = ` (unassigned: ${label(a.to, assigneeId)} is not a member who can take tasks)`), (assigneeId = null);
      const statusId = firstStatus(p.statuses, 'todo').id;
      const day = todayOf();
      const fields = {
        title: a.title, description: '', statusId, priority: 'normal', assigneeId, startDate: day, dueDate: a.dueIn == null ? null : addWorkDays(day, a.dueIn, cal()),
        size: null, milestoneId: t.milestoneId || null, parentId: a.subtask ? t.parentId || t.id : null, blockedBy: [],
      };
      const nt = newTask(p, SYSTEM, fields, { rank: nextRank(p, statusId), ruleId: r.id });
      nt.history[0].to = `rule: ${r.name} (after ${t.key})`;
      notify([assigneeId], 'assigned', p, nt, SYSTEM, `assigned you ${nt.key} ${nt.title}`);
      fire('created', nt, p, SYSTEM);
      if (assigneeId) fire('assigned', nt, p, SYSTEM);
      return `Made ${nt.key}${note}`;
    }
    return '';
  }

  // The rules of a task's project for what just happened to it (u: who did it, or SYSTEM).
  let chain = null; // { depth, ran: Set of ruleId:taskId } while rules run
  function fire(event, t, p, u) {
    if (p.isTemplate || d().modules?.projects === false) return;
    const rules = rulesOf(p).filter((r) => r.active && r.when.event === event && (event !== 'status' || !r.when.statusId || r.when.statusId === t.statusId));
    if (!rules.length) return;
    const outer = !chain;
    if (outer) chain = { depth: 0, ran: new Set() };
    try {
      if (chain.depth >= MAX_DEPTH) {
        for (const r of rules) if (matches(r, t)) logRun(p, { kind: 'rule', sourceId: r.id, name: r.name, result: 'skipped', taskId: t.id, taskKey: t.key, note: `Not run: rules set each other off more than ${MAX_DEPTH} times in a row. Check the rules for a loop.` });
        return;
      }
      chain.depth++;
      for (const r of rules) {
        const key = `${r.id}:${t.id}`;
        if (chain.ran.has(key) || !matches(r, t)) continue;
        chain.ran.add(key);
        const done = [];
        try {
          for (const a of r.actions) done.push(act(a, t, p, u, r));
          r.runs = (r.runs || 0) + 1;
          r.lastRunAt = now();
          logRun(p, { kind: 'rule', sourceId: r.id, name: r.name, result: 'done', taskId: t.id, taskKey: t.key, note: done.filter(Boolean).join('. ') });
        } catch (err) {
          const reason = String(err?.message || err).slice(0, 200);
          alertManagers(p, `could not finish the rule “${str(r.name, 60)}” on ${t.key}: ${reason}`);
          logRun(p, { kind: 'rule', sourceId: r.id, name: r.name, result: 'failed', taskId: t.id, taskKey: t.key, note: `${done.filter(Boolean).join('. ')}${done.length ? '. ' : ''}Stopped: ${reason}` });
        }
      }
      chain.depth--;
    } finally {
      if (outer) chain = null;
    }
  }

  // Tasks that became overdue (due before today, still open), once per task and due date, in
  // projects with an overdue rule. Called every minute; tests call it with their own clock.
  function runOverdue(at = clock()) {
    const day = localDate(at);
    const out = { day, tasks: 0 };
    if (d().modules?.projects === false) return { ...out, reason: 'module off' };
    for (const p of d().pmProjects) {
      if (!projectOpen(p) || !rulesOf(p).some((r) => r.active && r.when.event === 'overdue')) continue;
      for (const t of tasksOf(p)) {
        if (!t.dueDate || t.dueDate >= day || t.overdueSeen === t.dueDate || !isOpenCategory(categoryOf(p, t))) continue;
        t.overdueSeen = t.dueDate;
        out.tasks++;
        fire('overdue', t, p, SYSTEM);
      }
    }
    if (out.tasks) db.save();
    return out;
  }
  // A new or turned-on overdue rule is for tasks that become overdue from then on, not those
  // already late (it would flood the log and the assignees).
  function markOverdue(p) {
    const day = todayOf();
    for (const t of tasksOf(p)) if (t.dueDate && t.dueDate < day && isOpenCategory(categoryOf(p, t))) t.overdueSeen = t.dueDate;
  }

  route('POST', '/api/pm/projects/:id/rules', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    if (rulesOf(p).length >= MAX_RULES) throw new HttpError(400, `A project can have up to ${MAX_RULES} rules. Delete one you no longer need first.`);
    const c = cleanRule(body, ruleCtx(p));
    if (c.error) throw new HttpError(400, c.error);
    const at = now();
    const r = { id: randomUUID(), projectId: p.id, ...c.rule, runs: 0, lastRunAt: null, version: 1, createdAt: at, createdBy: u.id, updatedAt: at, updatedBy: u.id };
    d().pmRules.push(r);
    if (r.active && r.when.event === 'overdue') markOverdue(p);
    db.save();
    return ruleOut(r, p);
  });
  route('PUT', '/api/pm/projects/:id/rules/:rid', 'auth', ({ params, body, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    const r = findRule(p, params.rid);
    if (body?.version != null && body.version !== r.version) throw new HttpError(409, `This rule was changed by ${userName(r.updatedBy) || 'someone else'} since you opened it. Close the form, reload, and make your change again.`);
    const onlyActive = body && Object.keys(body).every((k) => ['active', 'version'].includes(k));
    if (onlyActive) {
      if (typeof body.active !== 'boolean') throw new HttpError(400, 'Say whether the rule is on.');
      r.active = body.active;
    } else {
      const c = cleanRule(body, ruleCtx(p));
      if (c.error) throw new HttpError(400, c.error);
      Object.assign(r, c.rule);
    }
    if (r.active && r.when.event === 'overdue') markOverdue(p);
    bump(r, u);
    db.save();
    return ruleOut(r, p);
  });
  route('DELETE', '/api/pm/projects/:id/rules/:rid', 'auth', ({ params, user: u }) => {
    const p = findProject(params.id, u, 'manage');
    const r = findRule(p, params.rid);
    d().pmRules = d().pmRules.filter((x) => x !== r);
    db.save();
    return { ok: true };
  });

  // A copy (or a project from a template) gets the rules that name no one in particular (people
  // are not copied), with milestones mapped to the copy's.
  function copyRules(src, p, msIds, u) {
    const namesSomeone = (r) => r.conditions.some((c) => c.field === 'assignee' && c.value) || r.actions.some((a) => (a.to && !['none', 'assignee', 'watchers', 'managers', ...Object.keys(WHO)].includes(a.to)));
    for (const r of rulesOf(src)) {
      if (namesSomeone(r)) continue;
      const copy = structuredClone(r);
      copy.conditions = copy.conditions.filter((c) => c.field !== 'milestone' || !c.value || msIds.has(c.value)).map((c) => (c.field === 'milestone' && c.value ? { ...c, value: msIds.get(c.value) } : c));
      const at = now();
      d().pmRules.push({ ...copy, id: randomUUID(), projectId: p.id, runs: 0, lastRunAt: null, version: 1, createdAt: at, createdBy: u.id, updatedAt: at, updatedBy: u.id });
    }
  }

  return { runRecurring, runOverdue, copyRecurring, copyRules, fire, logRun, alertManagers };
}
