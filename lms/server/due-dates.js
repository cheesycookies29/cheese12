// Due dates in ATLAS People (HRIS request PL-053): renewals of appointments, probation evaluations,
// step increments and retirements, worked out from the employee records (the rules, the dates and the
// arithmetic: shared/due-dates.js).
//
//  - People → Due dates (permission hris.due, the HR Manager's by default): every active employee at
//    the person's campuses with an upcoming or overdue date, with Mark done (a date and a note) and
//    Snooze (a number of days and a note). A renewal is also marked done by itself when a new
//    appointment of that person is confirmed (server/appointment.js).
//  - The bell: a sweep, when the server starts and every six hours, tells HR (the accounts with
//    hris.due at the employee's campus) once per occurrence and lead day, and the employee too where
//    the rule says so. What was sent is kept in db.data.dueAlertsSent ({ key: [lead days] }), so a
//    restart never sends again; an entry goes when its occurrence is done or no longer exists.
//  - HR settings → Alerts and due dates (hris.settings), also in the Settings center.
//  - My HR record: the employee sees their own upcoming date for the rules that tell the employee.
//  - Mark done, snooze and reopen are in the audit log; settings changes in the Settings history.
//  - ATLAS does not link an employee to a head of office or supervisor, so nobody else is told.
import { randomUUID } from 'node:crypto';
import { HttpError, text } from './util.js';
import { t } from './validate.js';
import { campusName, campusesFor } from './campus.js';
import { decidersFor, accountOfEmployee, EMPLOYEE_ROLES, fmtDay } from './notifications.js';
import { userCan } from '../shared/roles.js';
import { stepsIn, salaryFor, APPOINTMENTS } from '../shared/gov-pay.js';
import {
  RULE_KINDS, RULE_IDS, LIMITS, LIST_DAYS, CONFIRM_NOTE, RECORD_DATE_FIELDS, mergeDueSettings, parseLeadDays, occurrencesOf, recordDates, leadsCrossed,
  whenText, daysBetween, statusOf, isDate, addDays, addMonths,
} from '../shared/due-dates.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const SWEEP_MS = 6 * 60 * 60 * 1000;

export const dueSettings = (data) => mergeDueSettings(data.settings?.dueDates);
const government = (data) => data.hrSettings?.payrollSystem !== 'private';
const nameOf = (e) => `${e.firstName} ${e.lastName}`;
const marks = (data) => (Array.isArray(data.dueMarks) ? data.dueMarks : (data.dueMarks = []));
const sentMap = (data) => (data.dueAlertsSent && typeof data.dueAlertsSent === 'object' && !Array.isArray(data.dueAlertsSent) ? data.dueAlertsSent : (data.dueAlertsSent = {}));

// The date of assumption of an appointment (for the date of original appointment).
const assumptions = (data) => {
  const m = new Map((data.appointments || []).map((a) => [a.id, a.fields?.assumptionDate || '']));
  return (id) => (id ? m.get(id) || '' : '');
};

// Every occurrence of every rule for `employees` (whether the rule is on or not), with what is missing.
export function allOccurrences(data, employees = data.employees) {
  const settings = dueSettings(data);
  const gov = government(data);
  const assumptionOf = assumptions(data);
  const list = [];
  const missing = [];
  for (const emp of employees) {
    const r = occurrencesOf(emp, settings, { gov, stepsIn, assumptionOf });
    list.push(...r.list);
    for (const m of r.missing) missing.push({ ...m, employeeId: emp.id });
  }
  return { list, missing, settings };
}
// The latest mark of an occurrence (done, or snoozed), or null.
export function markOf(data, key) {
  for (let i = marks(data).length - 1; i >= 0; i--) if (marks(data)[i].key === key) return marks(data)[i];
  return null;
}
// Open, snoozed (until a date after today) or done.
const stateOf = (m, today) => (!m ? 'open' : m.action === 'done' ? 'done' : m.action === 'snooze' && m.until > today ? 'snoozed' : 'open');

// The open occurrences of the rules that are on, with days left: for the bell, the list and the dashboard.
export function dueRows(data, today, { employees = data.employees, days = LIST_DAYS, withClosed = false } = {}) {
  const { list, settings } = allOccurrences(data, employees);
  const out = [];
  for (const o of list) {
    const rule = settings[o.kind];
    if (!rule.on) continue;
    const daysLeft = daysBetween(today, o.due);
    if (daysLeft > Math.max(days, ...rule.leadDays)) continue;
    const m = markOf(data, o.key);
    const state = stateOf(m, today);
    if (state !== 'open' && !withClosed) continue;
    out.push({ ...o, daysLeft, state, mark: m, rule });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.kind.localeCompare(b.kind));
}
// Overdue and due within 30 days, for the HR dashboard and the sidebar.
export function dueSummary(data, today, employees) {
  const rows = dueRows(data, today, { employees, days: 30 }).filter((r) => r.daysLeft <= 30);
  return { soon: rows.length, overdue: rows.filter((r) => r.daysLeft < 0).length };
}

// A mark (done, snooze, reopen): kept in db.data.dueMarks; done takes the occurrence off the bell for good.
function addMark(data, o, mark) {
  const m = { id: randomUUID(), key: o.key, kind: o.kind, employeeId: o.employeeId, due: o.due, ...mark };
  marks(data).push(m);
  if (m.action === 'done') delete sentMap(data)[o.key];
  return m;
}

// A new appointment of this person was confirmed (server/appointment.js): an open renewal of the
// appointment it replaces is done. Returns the occurrences closed.
export function closeRenewals(data, emp, { by, byId = null, at, on, note }) {
  const settings = dueSettings(data);
  const st = statusOf(emp);
  if (!isDate(emp.appointmentEndDate) || !settings.renewal.statuses.includes(st)) return [];
  const o = { key: `renewal:${emp.id}:${emp.appointmentEndDate}`, kind: 'renewal', employeeId: emp.id, due: emp.appointmentEndDate };
  const m = markOf(data, o.key);
  if (m?.action === 'done') return [];
  addMark(data, o, { action: 'done', on, note, at, by, byId, auto: true });
  return [o];
}

// ----- The sweep: the bell, once per occurrence and lead day -----
function bellText(rule, o, emp, daysLeft, data) {
  const name = nameOf(emp);
  const when = whenText(daysLeft);
  const date = fmtDay(o.due);
  const st = statusOf(emp);
  const hr = {
    renewal: `${rule.name}: ${name}'s appointment ends ${when}`,
    probation: `${rule.name}: ${name}, due ${when}`,
    step: `${rule.name}: ${name}, due ${when}`,
    retirement: `${rule.name}: ${name} turns ${rule.age} ${when}`,
    optionalRetirement: `${rule.name}: ${name} turns ${rule.age} ${when}`,
  }[o.kind];
  const mine = {
    renewal: `Your appointment ends on ${date}`,
    retirement: `You reach the compulsory retirement age (${rule.age}) on ${date}`,
    optionalRetirement: `You may retire from ${date} (age ${rule.age})`,
  }[o.kind];
  return {
    hr: { title: hr, body: [date, st, emp.department, campusName(data, emp.campusId)].filter(Boolean).join(' · '), link: `/hris/#/due-dates?rule=${o.kind}` },
    employee: mine ? { title: mine, body: `${when.charAt(0).toUpperCase()}${when.slice(1)}. HR has been told; ask them about the next steps.`, link: '/hris/#/me/profile' } : null,
  };
}
export function sweepDueDates(data, today, { notify }) {
  const sent = sentMap(data);
  const { list, settings } = allOccurrences(data);
  const live = new Set(list.map((o) => o.key));
  let changed = false;
  // Markers of occurrences that no longer exist (a date changed, the employee left) go; so do marks.
  for (const k of Object.keys(sent)) if (!live.has(k)) (delete sent[k], (changed = true));
  const kept = marks(data).filter((m) => live.has(m.key));
  if (kept.length !== marks(data).length) (data.dueMarks = kept), (changed = true);
  const byId = new Map(data.employees.map((e) => [e.id, e]));
  for (const o of list) {
    const rule = settings[o.kind];
    if (!rule.on) continue;
    const state = stateOf(markOf(data, o.key), today);
    if (state === 'done') {
      if (sent[o.key]) (delete sent[o.key], (changed = true));
      continue;
    }
    if (state === 'snoozed') continue;
    const daysLeft = daysBetween(today, o.due);
    const { crossed, current } = leadsCrossed(rule.leadDays, daysLeft);
    if (current == null || (sent[o.key] || []).includes(current)) continue;
    const emp = byId.get(o.employeeId);
    const msg = bellText(rule, o, emp, daysLeft, data);
    const demo = Boolean(emp.demo);
    const kind = `due.${o.kind}`.slice(0, 40);
    if (rule.tellHr) notify(decidersFor(data, 'hris.due', { campusId: emp.campusId, roles: EMPLOYEE_ROLES }), { system: 'hris', kind, ...msg.hr }, { demo });
    const acct = rule.tellEmployee && msg.employee ? accountOfEmployee(data, emp.id) : null;
    if (acct) notify([acct.id], { system: 'hris', kind, ...msg.employee }, { demo });
    sent[o.key] = [...new Set([...(sent[o.key] || []), ...crossed])].sort((a, b) => b - a);
    changed = true;
  }
  return changed;
}

// ----- Settings: HR settings → Alerts and due dates -----
// The settings as HR saves them: each rule sent is checked (a part left out keeps its current value;
// a rule left out stays as it is); a problem refuses the whole save.
export function cleanDueSettings(body, statuses, current = mergeDueSettings({})) {
  const next = mergeDueSettings(current);
  const problems = [];
  for (const k of RULE_KINDS) {
    const cur = next[k.kind];
    if (!body?.[k.kind] || typeof body[k.kind] !== 'object') continue;
    const v = { ...cur, ...Object.fromEntries(Object.entries(body[k.kind]).filter(([, x]) => x != null)) };
    const name = text(v.name, LIMITS.name + 1);
    if (!name) problems.push(`${k.label}: give it a name.`);
    else if (name.length > LIMITS.name) problems.push(`${k.label}: a name has at most ${LIMITS.name} characters.`);
    const lead = parseLeadDays(v.leadDays);
    if (!lead || !lead.length) problems.push(`${name || k.label}: lead days are whole days from 0 to ${LIMITS.leadMax}, e.g. 60, 30, 7.`);
    else if (lead.length > LIMITS.leadDays) problems.push(`${name || k.label}: at most ${LIMITS.leadDays} lead days.`);
    Object.assign(cur, { on: v.on !== false, name: name.slice(0, LIMITS.name) || cur.name, leadDays: lead && lead.length ? lead.slice(0, LIMITS.leadDays) : cur.leadDays, tellHr: v.tellHr !== false, tellEmployee: k.employee ? v.tellEmployee === true : false });
    if (k.param) {
      const n = Number(v[k.param.key]);
      if (!Number.isInteger(n) || n < k.param.min || n > k.param.max) problems.push(`${name || k.label}: ${k.param.label.toLowerCase()} is a whole number from ${k.param.min} to ${k.param.max}.`);
      else cur[k.param.key] = n;
    }
    if (k.kind === 'renewal' && Array.isArray(body[k.kind].statuses)) {
      const list = [...new Set(body[k.kind].statuses.map(String))];
      const bad = list.filter((x) => !statuses.includes(x));
      if (bad.length) problems.push(`${name || k.label}: ${bad.join(', ')} is not a status of appointment here.`);
      cur.statuses = list.filter((x) => statuses.includes(x));
    }
  }
  if (problems.length) fail(`Not saved. ${problems.slice(0, 6).join(' ')}`);
  return next;
}
const RULE_BODY = t.obj({ on: t.bool(), name: t.str(400), leadDays: t.any(), tellHr: t.bool(), tellEmployee: t.bool(), months: t.any(), years: t.any(), age: t.any(), statuses: t.arr(t.str(60), 30) });

// ----- The routes -----
export function registerDueDateRoutes(route, ctx) {
  const { db } = ctx;
  const data = () => db.data;
  const save = () => db.save();
  const today = () => ctx.today();
  const statusChoices = () => (government(data()) ? APPOINTMENTS.filter((a) => !['Job order', 'Contract of service'].includes(a)) : ['Probationary', 'Regular', 'Contractual', 'Part-time']);
  const campusIdsOf = (user) => new Set(campusesFor(data(), user).map((c) => c.id));
  const employeesOf = (user) => {
    const ids = campusIdsOf(user);
    return data().employees.filter((e) => ids.has(e.campusId));
  };

  function sweep() {
    const changed = sweepDueDates(data(), today(), { notify: (ids, entry, opts) => ctx.notify(ids, entry, opts) });
    if (changed) save();
    return changed;
  }
  sweep();
  setInterval(sweep, SWEEP_MS).unref?.(); // four times a day: an alert is never late by more than that

  // A row of the list: the person, the rule, the date and the current appointment.
  const rowView = (r, emp) => ({
    key: r.key, kind: r.kind, ruleName: r.rule.name, due: r.due, base: r.base, detail: r.detail, daysLeft: r.daysLeft, state: r.state,
    mark: r.mark ? { action: r.mark.action, on: r.mark.on || '', until: r.mark.until || '', note: r.mark.note || '', at: r.mark.at, by: r.mark.by, auto: Boolean(r.mark.auto) } : null,
    employee: {
      id: emp.id, name: `${emp.lastName}, ${emp.firstName}`, employeeNo: emp.employeeNo, position: emp.position || '', status: statusOf(emp),
      salaryGrade: emp.salaryGrade || null, step: emp.salaryGrade ? emp.step || 1 : null, office: emp.department || '', campusId: emp.campusId, campusName: campusName(data(), emp.campusId),
      lastStepIncrementDate: emp.lastStepIncrementDate || '',
    },
  });
  const settingsView = () => ({
    rules: dueSettings(data()), kinds: RULE_KINDS, statuses: statusChoices(), confirmNote: CONFIRM_NOTE,
    updatedAt: data().settings.dueDatesUpdatedAt || null, updatedBy: data().settings.dueDatesUpdatedBy || '',
  });

  route('GET', '/api/hris/due-dates', 'hris:hris.due', ({ user }) => {
    const emps = employeesOf(user);
    const byId = new Map(emps.map((e) => [e.id, e]));
    const rows = dueRows(data(), today(), { employees: emps, withClosed: true });
    const { missing, settings } = allOccurrences(data(), emps);
    return {
      today: today(),
      rules: RULE_KINDS.map((k) => ({ kind: k.kind, name: settings[k.kind].name, on: settings[k.kind].on, leadDays: settings[k.kind].leadDays })),
      rows: rows.map((r) => rowView(r, byId.get(r.employeeId))),
      missing: missing.filter((m) => settings[m.kind].on).map((m) => ({ kind: m.kind, reason: m.reason, employeeId: m.employeeId, name: nameOf(byId.get(m.employeeId)), campusName: campusName(data(), byId.get(m.employeeId).campusId) })),
      campuses: campusesFor(data(), user).map((c) => ({ id: c.id, name: c.name })),
      canSettings: userCan(user, 'hris.settings'), canEdit: userCan(user, 'employees.edit'),
    };
  }, { audit: false });
  route('GET', '/api/hris/due-dates/summary', 'hris:hris.due', ({ user, query }) => {
    const ids = query.campusId ? new Set([String(query.campusId)].filter((x) => campusIdsOf(user).has(x))) : campusIdsOf(user);
    return dueSummary(data(), today(), data().employees.filter((e) => ids.has(e.campusId)));
  }, { audit: false });

  // One occurrence at the person's campuses (open, snoozed or done), or 404.
  const occurrenceFor = (user, key) => {
    const k = String(key || '');
    const r = dueRows(data(), today(), { employees: employeesOf(user), withClosed: true, days: 100000 }).find((x) => x.key === k);
    return r || fail('That due date is not on the list any more (its date changed, or the employee left). Reload the list.', 404);
  };
  const audit = (user, r, action, { detail = '', changes = [], ip = '', agent = '' } = {}) => {
    const emp = data().employees.find((e) => e.id === r.employeeId);
    ctx.audit({ kind: 'change', system: 'people', action: `Due dates: ${action}`, actor: user, target: { id: emp.id, name: `${nameOf(emp)} (${emp.employeeNo})` }, ip, agent, detail: `${r.rule.name} · due ${r.due}${detail ? ` · ${detail}` : ''}`, changes });
  };
  route('POST', '/api/hris/due-dates/done', 'hris:hris.due', ({ user, body, ip, agent }) => {
    const r = occurrenceFor(user, body.key);
    if (r.state === 'done') fail('This one is already marked done.');
    const on = text(body.on, 10) || today();
    if (!isDate(on)) fail('Pick the date it was done.');
    if (on > today()) fail('The date it was done cannot be in the future.');
    const note = text(body.note, LIMITS.note);
    const changes = [];
    // A step increment given: its date can become the record's date of last step increment (never the step or the pay).
    if (r.kind === 'step' && body.recordStep === true) {
      const emp = data().employees.find((e) => e.id === r.employeeId);
      if (!userCan(user, 'employees.edit')) fail('Recording the date on the employee record needs Add and edit employee records. Untick it, or ask HR.', 403);
      if (user.employeeId === emp.id) fail('You cannot change your own HR record. Another HR person does.', 403);
      changes.push({ field: 'Date of last step increment', from: emp.lastStepIncrementDate || '', to: on });
      emp.lastStepIncrementDate = on;
      emp.updatedAt = new Date(ctx.now()).toISOString();
    }
    addMark(data(), r, { action: 'done', on, note, at: new Date(ctx.now()).toISOString(), by: user.name, byId: user.id });
    audit(user, r, 'marked done', { ip, agent, detail: `Done on ${on}${note ? ` · ${note}` : ''}`, changes });
    save();
    return { ok: true };
  }, { audit: false, body: { key: t.str(200), on: t.str(20), note: t.str(2000), recordStep: t.bool() } });
  route('POST', '/api/hris/due-dates/snooze', 'hris:hris.due', ({ user, body, ip, agent }) => {
    const r = occurrenceFor(user, body.key);
    if (r.state === 'done') fail('This one is marked done: reopen it first.');
    const days = Number(body.days);
    if (!Number.isInteger(days) || days < 1 || days > LIMITS.snoozeMax) fail(`Snooze for 1 to ${LIMITS.snoozeMax} days.`);
    const until = addDays(today(), days);
    const note = text(body.note, LIMITS.note);
    addMark(data(), r, { action: 'snooze', until, days, note, at: new Date(ctx.now()).toISOString(), by: user.name, byId: user.id });
    audit(user, r, `snoozed for ${days} day${days === 1 ? '' : 's'}`, { ip, agent, detail: `Until ${until}${note ? ` · ${note}` : ''}` });
    save();
    return { ok: true, until };
  }, { audit: false, body: { key: t.str(200), days: t.any(), note: t.str(2000) } });
  // Reopen: a mark made by mistake is undone (it stays in the audit log).
  route('POST', '/api/hris/due-dates/reopen', 'hris:hris.due', ({ user, body, ip, agent }) => {
    const r = occurrenceFor(user, body.key);
    if (r.state === 'open') fail('This one is open already.');
    addMark(data(), r, { action: 'reopen', at: new Date(ctx.now()).toISOString(), by: user.name, byId: user.id, note: '' });
    audit(user, r, r.state === 'done' ? 'reopened (it was marked done)' : 'reopened (it was snoozed)', { ip, agent });
    save();
    return { ok: true };
  }, { audit: false, body: { key: t.str(200) } });

  // ----- Settings -----
  route('GET', '/api/hris/due-dates/settings', 'hris', ({ user }) => {
    if (!userCan(user, 'hris.settings') && !userCan(user, 'hris.due')) fail('Your account does not have access to this.', 403);
    return settingsView();
  }, { audit: false });
  route('PUT', '/api/hris/due-dates/settings', 'hris:hris.settings', ({ body, user }) => {
    data().settings.dueDates = cleanDueSettings(body, statusChoices(), dueSettings(data()));
    data().settings.dueDatesUpdatedAt = new Date(ctx.now()).toISOString();
    data().settings.dueDatesUpdatedBy = user.name;
    sweep(); // a new lead day that has already come is sent now
    save();
    return settingsView();
  }, { body: Object.fromEntries(RULE_IDS.map((k) => [k, RULE_BODY])) });

  // ----- The employee: My HR record → Coming up (only the rules that tell the employee) -----
  route('GET', '/api/hris/me/due-dates', 'hris', ({ user }) => {
    const emp = user.employeeId && data().employees.find((e) => e.id === user.employeeId);
    if (!emp) return { items: [] };
    const rows = dueRows(data(), today(), { employees: [emp], days: 0 }).filter((r) => r.rule.tellEmployee && r.daysLeft <= Math.max(...r.rule.leadDays));
    return {
      items: rows.map((r) => ({
        kind: r.kind, due: r.due, daysLeft: r.daysLeft,
        text: { renewal: 'Your appointment ends on', retirement: `You reach the compulsory retirement age (${r.rule.age}) on`, optionalRetirement: `You may retire (age ${r.rule.age}) from` }[r.kind] || r.rule.name,
      })),
    };
  }, { audit: false });

  return { sweep, summary: (user, campusId) => dueSummary(data(), today(), data().employees.filter((e) => e.campusId === campusId && campusIdsOf(user).has(e.campusId))) };
}

// The employee record screens: the dates the rules count from, as recorded or worked out.
export function recordDatesView(data, emp) {
  const d = recordDates(emp, { assumptionOf: assumptions(data) });
  return { appointmentEndDate: d.appointmentEndDate, originalAppointmentDate: d.originalAppointmentDate, stepBase: d.stepBase };
}
export { RECORD_DATE_FIELDS };

// ----- Demo: a renewal in 20 days, a probation evaluation in 15 days, a step increment 5 days overdue
// and a compulsory retirement in 150 days, on demo employees at the main campus (dates from today).
// The step, salary and dates are set as HR would have recorded them; every record is already demo.
export function addDueDatesDemo(data, today) {
  const find = (first, last) => data.employees.find((e) => e.demo && e.firstName === first && e.lastName === last);
  // The first date from which adding `n` (months) lands on `target` (or just after it, for a short month).
  const back = (target, months) => {
    let d = addMonths(target, -months);
    while (addMonths(d, months) < target) d = addDays(d, 1);
    return d;
  };
  const renewal = find('Paolo', 'Ilagan');
  if (renewal) Object.assign(renewal, { appointmentEndDate: addDays(today, 20) });
  const probation = find('Dolores', 'Bautista');
  if (probation) {
    const start = back(addDays(today, 15), 6);
    const gov = government(data);
    Object.assign(probation, { hireDate: start, originalAppointmentDate: start, appointment: gov ? 'Permanent' : '', employmentStatus: gov ? 'Permanent' : 'Probationary' });
    if (probation.salaryGrade) Object.assign(probation, { step: 1, rate: salaryFor(probation.salaryGrade, 1, today) });
  }
  const step = find('Arlene', 'Sarmiento');
  if (step) {
    Object.assign(step, { lastStepIncrementDate: back(addDays(today, -5), 36) });
    if (step.salaryGrade) Object.assign(step, { step: Math.min(step.step || 1, stepsIn(step.salaryGrade) - 1) });
  }
  const retiring = find('Nestor', 'Abello');
  if (retiring) Object.assign(retiring, { birthDate: back(addDays(today, 150), 65 * 12) });
}
