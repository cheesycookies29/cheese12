// Project automations (0.61): recurring tasks and the run log.
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
// Called from registerProjectRoutes (server/projects.js) with its helpers (`h`).
import { randomUUID } from 'node:crypto';
import { HttpError, localDate } from './util.js';
import { cleanSchedule, nextOccurrence, upcoming, describeSchedule, MAX_DUE_IN, MAX_RECURRING } from '../shared/pm-recurring.js';
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
  const { findProject, levelOf, newTask, notify, activeUser, userName, cal, clock, audit, tasksOf, nextRank, bump } = h;
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

  return { runRecurring, copyRecurring, logRun, alertManagers };
}
