// Automation rules (0.62): "When … If … Then …" for a project's tasks. Shared by the server (which
// checks and runs them, server/pm-automation.js) and the browser (the form and the sentence each
// rule reads as).
//
// A rule: { name, active, when: { event, statusId }, conditions: [{ field, op, value }],
//           actions: [{ type, …values }] }
// when.event: what happens to a task (RULE_EVENTS). For 'status', statusId is the column it moves
// to (null: any). Conditions all have to hold, on the task as it is after the change. Actions run
// in order, done by CORE.
import { PRIORITY, SIZES, statusOf } from './projects.js';

export const RULE_EVENTS = {
  created: 'A task is added',
  status: 'A task moves to a status',
  assigned: 'A task is assigned to someone',
  commented: 'Someone comments on a task',
  overdue: 'A task becomes overdue',
  subtasksDone: 'All the subtasks of a task are done',
};
export const RULE_FIELDS = { priority: 'Priority', assignee: 'Assignee', status: 'Status', milestone: 'Milestone', size: 'Size', title: 'Title', kind: 'The task' };
// Which tests each field takes.
export const FIELD_OPS = {
  priority: ['is', 'isNot'], assignee: ['is', 'isNot', 'empty', 'set'], status: ['is', 'isNot'], milestone: ['is', 'isNot', 'empty', 'set'],
  size: ['is', 'isNot', 'empty', 'set'], title: ['contains', 'notContains'], kind: ['is', 'isNot'],
};
export const OPS = { is: 'is', isNot: 'is not', empty: 'is empty', set: 'is set', contains: 'contains', notContains: 'does not contain' };
export const TASK_KINDS = { subtask: 'a subtask', top: 'not a subtask', recurring: 'made by a recurring task' };
export const RULE_ACTIONS = {
  status: 'Move it to',
  assign: 'Assign it to',
  priority: 'Set its priority to',
  due: 'Set its due date to',
  watch: 'Add as a watcher',
  notify: 'Notify',
  comment: 'Add a comment',
  checklist: 'Add checklist items',
  task: 'Create a task',
};
// People a rule can name besides members: who added the task, the project's manager, nobody.
export const WHO = { creator: 'Who added the task', manager: 'The project manager', actor: 'Who made the change' };
export const NOTIFY_TO = { assignee: 'Its assignee', watchers: 'Its watchers', managers: 'The project\'s managers', creator: 'Who added the task' };
export const MAX_RULES = 30; // per project
export const MAX_CONDITIONS = 6;
export const MAX_ACTIONS = 6;
export const MAX_DEPTH = 3; // a rule's change may set off another rule, this many steps deep at most

const text = (v, max) => (v == null || typeof v === 'object' ? '' : String(v)).trim().slice(0, max);
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;

// The rule as sent by the form, checked against the project: { rule } or { error }.
// ctx: { statuses, takers: [userId] (members who can take tasks), members: [userId], milestones: [id] }
export function cleanRule(raw, ctx) {
  if (!raw || typeof raw !== 'object') return { error: 'Send the rule.' };
  const name = text(raw.name, 120);
  if (!name) return { error: 'Name the rule, so its runs can be told apart in the log.' };
  const event = raw.when?.event;
  if (!Object.hasOwn(RULE_EVENTS, event)) return { error: 'When: pick what happens to a task.' };
  let statusId = null;
  if (event === 'status' && raw.when.statusId) {
    if (!ctx.statuses.some((s) => s.id === raw.when.statusId)) return { error: 'When: pick a status of this project, or any status.' };
    statusId = raw.when.statusId;
  }
  const condList = raw.conditions == null ? [] : raw.conditions;
  if (!Array.isArray(condList) || condList.length > MAX_CONDITIONS) return { error: `If: up to ${MAX_CONDITIONS} conditions.` };
  const conditions = [];
  for (const c of condList) {
    const field = c?.field;
    if (!Object.hasOwn(RULE_FIELDS, field)) return { error: 'If: pick what each condition looks at.' };
    const op = c.op;
    if (!FIELD_OPS[field].includes(op)) return { error: `If: ${RULE_FIELDS[field]} cannot be tested that way.` };
    let value = null;
    if (op === 'is' || op === 'isNot') {
      value = c.value;
      const ok = field === 'priority' ? Object.hasOwn(PRIORITY, value) : field === 'size' ? Object.hasOwn(SIZES, value) : field === 'kind' ? Object.hasOwn(TASK_KINDS, value)
        : field === 'status' ? ctx.statuses.some((s) => s.id === value) : field === 'milestone' ? ctx.milestones.includes(value) : field === 'assignee' ? ctx.members.includes(value) : false;
      if (!ok) return { error: `If: pick the ${RULE_FIELDS[field].toLowerCase()} to compare with.` };
    } else if (op === 'contains' || op === 'notContains') {
      value = text(c.value, 100);
      if (!value) return { error: 'If: write the words the title should (or should not) contain.' };
    }
    conditions.push({ field, op, value });
  }
  const actList = Array.isArray(raw.actions) ? raw.actions : [];
  if (!actList.length) return { error: 'Then: add at least one action.' };
  if (actList.length > MAX_ACTIONS) return { error: `Then: up to ${MAX_ACTIONS} actions.` };
  const who = (v, label) => {
    if (Object.hasOwn(WHO, v) || ctx.takers.includes(v)) return { ok: v };
    return { error: `Then: ${label}: pick a member who can take tasks, ${Object.values(WHO).map((x) => x.toLowerCase()).join(', ')}.` };
  };
  const actions = [];
  for (const a of actList) {
    const type = a?.type;
    if (!Object.hasOwn(RULE_ACTIONS, type)) return { error: 'Then: pick what each action does.' };
    if (type === 'status') {
      if (!ctx.statuses.some((s) => s.id === a.statusId)) return { error: 'Then: pick the status to move it to.' };
      actions.push({ type, statusId: a.statusId });
    } else if (type === 'assign') {
      if (a.to === 'none') actions.push({ type, to: 'none' });
      else {
        const w = who(a.to, 'Assign it to');
        if (w.error) return w;
        actions.push({ type, to: w.ok });
      }
    } else if (type === 'priority') {
      if (!Object.hasOwn(PRIORITY, a.priority)) return { error: 'Then: pick the priority.' };
      actions.push({ type, priority: a.priority });
    } else if (type === 'due') {
      const days = Number(a.days);
      if (!Number.isInteger(days) || days < 0 || days > 60) return { error: 'Then: the due date is 0 to 60 working days from the day the rule runs.' };
      actions.push({ type, days });
    } else if (type === 'watch') {
      if (a.to !== 'manager' && a.to !== 'creator' && !ctx.members.includes(a.to)) return { error: 'Then: pick who watches it.' };
      actions.push({ type, to: a.to });
    } else if (type === 'notify') {
      if (!Object.hasOwn(NOTIFY_TO, a.to) && !ctx.members.includes(a.to)) return { error: 'Then: pick who is notified.' };
      const msg = text(a.text, 120);
      if (!msg) return { error: 'Then: write the notification\'s message.' };
      actions.push({ type, to: a.to, text: msg });
    } else if (type === 'comment') {
      const body = text(a.text, 1000);
      if (!body) return { error: 'Then: write the comment.' };
      actions.push({ type, text: body });
    } else if (type === 'checklist') {
      const items = (Array.isArray(a.items) ? a.items : String(a.items || '').split('\n')).map((x) => text(x, 300)).filter(Boolean);
      if (!items.length || items.length > 20) return { error: 'Then: 1 to 20 checklist items, one per line.' };
      actions.push({ type, items });
    } else if (type === 'task') {
      const title = text(a.title, 200);
      if (!title) return { error: 'Then: give the new task a title.' };
      let to = null;
      if (a.to && a.to !== 'none') {
        const w = who(a.to, 'Assign the new task to');
        if (w.error) return w;
        to = w.ok;
      }
      const dueIn = a.dueIn == null || a.dueIn === '' ? null : Number(a.dueIn);
      if (dueIn !== null && (!Number.isInteger(dueIn) || dueIn < 0 || dueIn > 60)) return { error: 'Then: the new task is due 0 to 60 working days later, or has no due date.' };
      actions.push({ type, title, to, dueIn, subtask: a.subtask === true });
    }
  }
  // A rule that undoes its own trigger would run for ever: "moves to X → move it to X" is pointless.
  if (event === 'status' && statusId && actions.some((a) => a.type === 'status' && a.statusId === statusId)) return { error: 'Then: it already moved to that status; pick another, or another action.' };
  return { rule: { name, active: raw.active !== false, when: { event, statusId }, conditions, actions } };
}

// Do the conditions hold for this task? (Its project `p` for the status names.)
export function matches(rule, t) {
  return rule.conditions.every((c) => {
    const v = c.field === 'priority' ? t.priority : c.field === 'assignee' ? t.assigneeId : c.field === 'status' ? t.statusId : c.field === 'milestone' ? t.milestoneId
      : c.field === 'size' ? t.size : c.field === 'title' ? t.title : null;
    if (c.field === 'kind') {
      const is = c.value === 'subtask' ? Boolean(t.parentId) : c.value === 'top' ? !t.parentId : Boolean(t.recurringId);
      return c.op === 'is' ? is : !is;
    }
    if (c.op === 'empty') return !v;
    if (c.op === 'set') return Boolean(v);
    if (c.op === 'contains') return String(v || '').toLowerCase().includes(c.value.toLowerCase());
    if (c.op === 'notContains') return !String(v || '').toLowerCase().includes(c.value.toLowerCase());
    return c.op === 'is' ? v === c.value : v !== c.value;
  });
}

// In words. names: { person(id), status(id), milestone(id) } give the names shown.
export function describeRule(rule, p, names) {
  const st = (id) => statusOf(p, id)?.name || 'a removed status';
  const person = (id) => (WHO[id] ? WHO[id].toLowerCase() : names.person(id));
  const when = rule.when.event === 'status' ? `When a task moves to ${rule.when.statusId ? st(rule.when.statusId) : 'any status'}` : `When ${RULE_EVENTS[rule.when.event].charAt(0).toLowerCase()}${RULE_EVENTS[rule.when.event].slice(1)}`;
  const cond = (c) => {
    const what = c.field === 'kind' ? 'the task' : RULE_FIELDS[c.field].toLowerCase();
    if (c.op === 'empty' || c.op === 'set') return `${what} ${OPS[c.op]}`;
    if (c.op === 'contains' || c.op === 'notContains') return `${what} ${OPS[c.op]} “${c.value}”`;
    const val = c.field === 'priority' ? PRIORITY[c.value] : c.field === 'size' ? c.value : c.field === 'kind' ? TASK_KINDS[c.value] : c.field === 'status' ? st(c.value)
      : c.field === 'milestone' ? names.milestone(c.value) : names.person(c.value);
    if (c.field === 'kind') return c.op === 'is' ? `it is ${val}` : `it is not ${val.replace(/^not /, '')}`;
    return `${what} ${OPS[c.op]} ${val}`;
  };
  const act = (a) => ({
    status: () => `move it to ${st(a.statusId)}`,
    assign: () => (a.to === 'none' ? 'unassign it' : `assign it to ${person(a.to)}`),
    priority: () => `set its priority to ${PRIORITY[a.priority]}`,
    due: () => (a.days === 0 ? 'make it due that day' : `make it due ${a.days} working day${a.days === 1 ? '' : 's'} later`),
    watch: () => `add ${person(a.to)} as a watcher`,
    notify: () => `notify ${NOTIFY_TO[a.to] ? NOTIFY_TO[a.to].toLowerCase() : names.person(a.to)}`,
    comment: () => 'add a comment',
    checklist: () => `add ${a.items.length} checklist item${a.items.length === 1 ? '' : 's'}`,
    task: () => `create ${a.subtask ? 'a subtask' : 'a task'} “${a.title}”${a.to ? ` for ${person(a.to)}` : ''}`,
  })[a.type]();
  return {
    when,
    conditions: rule.conditions.map(cond),
    actions: rule.actions.map(act),
  };
}
