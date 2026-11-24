// Notifications for every account (the bell in the top bar), after CORE ERP's (server/notifications.js
// at the repository root). One row per person and event, in db.data.notifications, written by each
// system where something happens that someone else should know about: a request that needs their
// decision, or a decision on their own request (an enrollment, a submission, a grade sheet, a
// document request, a leave request, a payslip, a voucher, a purchase request, a requisition).
//
// Every item belongs to one account: the API reads and changes only the signed-in account's own.
// Texts are written when the event happens and say only what the linked page shows the recipient;
// nobody is told of their own action. A link is a page in ATLAS (shared/notifications.js).
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { userCan } from '../shared/roles.js';
import { inCampus } from './campus.js';
import { t } from './validate.js';
import { NOTIFY_SYSTEM_IDS, isAtlasLink } from '../shared/notifications.js';
import { DOCUMENT_TYPES } from '../shared/academic.js';

export const NOTIFY_KEEP = 200; // per person, newest kept
export const NOTIFY_DAYS = 60; // older ones are removed
export const TITLE_MAX = 160;
export const BODY_MAX = 300;
const KIND_MAX = 40;
const PAGE_MAX = 100;
const DAY_MS = 86400000;

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};

// One line of plain text, cut to `max` characters (with an ellipsis when cut).
export function clip(v, max) {
  const s = (v == null || typeof v === 'object' ? '' : String(v)).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
// A quoted snippet of someone's text, for a body: “…”.
export const quote = (text, max = 120) => `“${clip(text, max)}”`;

// Dates as the screens show them: "Aug 7, 2026"; a range "Aug 7, 2026 to Aug 9, 2026".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}
export const fmtRange = (a, b) => (!b || a === b ? fmtDay(a) : `${fmtDay(a)} to ${fmtDay(b)}`);
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Notifications older than 60 days go, and each person keeps their newest 200 (only `userId`'s
// are counted when given). Returns the same list when nothing went.
export function pruneNotifications(list, nowMs = Date.now(), userId = null) {
  const cutoff = new Date(nowMs - NOTIFY_DAYS * DAY_MS).toISOString();
  const kept = list.filter((n) => n.at >= cutoff);
  const per = new Map();
  for (const n of kept) if (!userId || n.userId === userId) per.set(n.userId, (per.get(n.userId) || 0) + 1);
  const over = [...per].filter(([, c]) => c > NOTIFY_KEEP);
  if (!over.length) return kept.length === list.length ? list : kept;
  const drop = new Set();
  for (const [id, c] of over) kept.filter((x) => x.userId === id).sort((a, b) => a.at.localeCompare(b.at)).slice(0, c - NOTIFY_KEEP).forEach((x) => drop.add(x));
  return kept.filter((x) => !drop.has(x));
}

const activeUser = (data, id) => data.users.find((u) => u.id === id && u.status === 'active') || null;

// Tells `userIds` about an event. entry: { system, kind, title, body, link }; actorId: who did it
// (never told of their own action). Skips missing or inactive accounts and repeated ids. The caller
// saves the database. Returns the rows written.
export function notify(data, userIds, entry, { actorId = null, at = new Date().toISOString(), nowMs = Date.parse(at), demo = false } = {}) {
  if (!NOTIFY_SYSTEM_IDS.includes(entry.system)) throw new Error(`A notification's system is one of ${NOTIFY_SYSTEM_IDS.join(', ')}.`);
  if (!isAtlasLink(entry.link)) throw new Error('A notification links to a page in ATLAS, such as "/lms/#/grades".');
  const title = clip(entry.title, TITLE_MAX);
  if (!title) throw new Error('A notification needs a title.');
  const body = clip(entry.body, BODY_MAX);
  const kind = clip(entry.kind, KIND_MAX) || entry.system;
  if (!Array.isArray(data.notifications)) data.notifications = [];
  const written = [];
  for (const userId of new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))) {
    if (userId === actorId || !activeUser(data, userId)) continue;
    const row = { id: randomUUID(), userId, system: entry.system, kind, title, body, link: entry.link, actorId: actorId || null, at, readAt: null, ...(demo ? { demo: true } : {}) };
    data.notifications.push(row);
    written.push(row);
  }
  if (written.length) data.notifications = pruneNotifications(data.notifications, nowMs);
  return written;
}

// ----- Who is told -----
// The accounts that decide on something: active accounts with the permission (at the campus, when
// one is given), other than `exclude`. Administrators have every permission, so they are told only
// when nobody else can decide (a school without that office yet).
// roles: only these account types (the ones that can open the system where the decision is made).
export function decidersFor(data, permission, { campusId = null, exclude = [], roles = null } = {}) {
  const out = new Set(exclude.filter(Boolean));
  const ok = (u) => u.status === 'active' && !out.has(u.id) && (!roles || u.role === 'admin' || roles.includes(u.role)) && userCan(u, permission);
  const staff = data.users.filter((u) => u.role !== 'admin' && ok(u) && (!campusId || inCampus(u, campusId)));
  return (staff.length ? staff : data.users.filter((u) => u.role === 'admin' && ok(u))).map((u) => u.id);
}
// The school's employees' account types (People and Finance's offices; not students or parents).
export const EMPLOYEE_ROLES = ['registrar', 'dean', 'teacher', 'hr', 'payroll', 'staff', 'accountant', 'budget', 'cashier', 'supply', 'approver'];
// The account linked to an employee record (active only), or null.
export const accountOfEmployee = (data, employeeId) => (employeeId && data.users.find((u) => u.employeeId === employeeId && u.status === 'active')) || null;

// ----- Accounts that go, demo data, backups -----
// An account that goes: its notifications go, and it is no longer named as the actor of others'.
export function forgetUser(data, userId) {
  data.notifications = (data.notifications || []).filter((n) => n.userId !== userId);
  for (const n of data.notifications) if (n.actorId === userId) n.actorId = null;
}
// After accounts were removed in bulk (the demo school): rows of accounts that are gone go, and
// actors that are gone are no longer named.
export function tidyNotifications(data) {
  const ids = new Set(data.users.map((u) => u.id));
  data.notifications = (data.notifications || []).filter((n) => ids.has(n.userId));
  for (const n of data.notifications) if (n.actorId && !ids.has(n.actorId)) n.actorId = null;
}

// A backup's notifications: rows of the right shape for accounts in it are kept (with their text
// trimmed and their link checked); anything else is left out.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
export function restoreNotifications(data, nowMs = Date.now()) {
  const ids = new Set(data.users.map((u) => u.id));
  const seen = new Set();
  const out = [];
  for (const n of Array.isArray(data.notifications) ? data.notifications : []) {
    if (!n || typeof n !== 'object' || Array.isArray(n)) continue;
    if (typeof n.id !== 'string' || !ID_RE.test(n.id) || seen.has(n.id) || !ids.has(n.userId)) continue;
    if (!NOTIFY_SYSTEM_IDS.includes(n.system) || !isAtlasLink(n.link) || typeof n.title !== 'string') continue;
    if (typeof n.at !== 'string' || !ISO_RE.test(n.at) || (n.readAt != null && (typeof n.readAt !== 'string' || !ISO_RE.test(n.readAt)))) continue;
    const title = clip(n.title, TITLE_MAX);
    if (!title) continue;
    seen.add(n.id);
    out.push({
      id: n.id, userId: n.userId, system: n.system, kind: clip(typeof n.kind === 'string' ? n.kind : '', KIND_MAX) || n.system, title,
      body: clip(typeof n.body === 'string' ? n.body : '', BODY_MAX), link: n.link,
      actorId: typeof n.actorId === 'string' && ids.has(n.actorId) ? n.actorId : null, at: n.at, readAt: n.readAt || null, ...(n.demo === true ? { demo: true } : {}),
    });
  }
  data.notifications = pruneNotifications(out, nowMs);
}

export function removeNotificationsDemo(data) {
  data.notifications = (data.notifications || []).filter((n) => !n.demo);
  tidyNotifications(data);
}
// The demo school: a few notifications for each demo account, drawn from the demo's own records and
// worded as the live events word them (some read, some not), so the bell has something to show.
// Every row is demo: true and goes with the demo.
export function addNotificationsDemo(data, nowMs = Date.now()) {
  removeNotificationsDemo(data);
  const at = (hoursAgo) => new Date(nowMs - hoursAgo * 3600000).toISOString();
  const byName = (username) => data.users.find((u) => u.demo && u.username === username) || null;
  const byId = (list, id) => list.find((x) => x.id === id) || null;
  // to, by: accounts (or null); read: already opened.
  const tell = (to, by, hoursAgo, entry, { read = false } = {}) => {
    if (!to) return;
    const [row] = notify(data, [to.id], entry, { actorId: by?.id || null, at: at(hoursAgo), nowMs, demo: true });
    if (row && read) row.readAt = at(Math.max(0, hoursAgo - 1));
  };
  const sectionName = (sectionId) => {
    const s = byId(data.sections, sectionId);
    return s ? `${byId(data.courses, s.courseId)?.code || '?'} ${s.name}` : 'a class';
  };
  const employeeName = (id) => {
    const e = byId(data.employees, id);
    return e ? `${e.firstName} ${e.lastName}` : 'An employee';
  };
  const registrar = byName('registrar.demo');
  const dean = byName('dean.demo');
  const hr = byName('hr.demo');

  // Learn: Carlo's enrollment approved and his work scored; his parents told of a final grade.
  const carlo = byName('student.demo');
  const enrolled = carlo && data.enrollments.find((e) => e.demo && e.studentId === carlo.id && e.status === 'enrolled');
  if (enrolled) tell(carlo, registrar, 30, { system: 'lms', kind: 'enrollment.approved', title: `${registrar?.name || 'The registrar'} approved your enrollment in ${sectionName(enrolled.sectionId)}`, body: byId(data.terms, enrolled.termId)?.name || '', link: '/lms/#/enroll/mine' }, { read: true });
  const scored = carlo && data.submissions.filter((x) => x.studentId === carlo.id && x.score != null).map((x) => byId(data.assignments, x.assignmentId)).find(Boolean);
  const scoredBy = scored && byId(data.users, byId(data.sections, scored.sectionId)?.teacherId);
  if (scored) tell(carlo, scoredBy, 5, { system: 'lms', kind: 'submission.scored', title: `${scoredBy?.name || 'Your teacher'} scored your work on ${scored.title}`, body: `${sectionName(scored.sectionId)} · See your score and the feedback`, link: `/lms/#/assignments/${scored.id}` });
  const finished = carlo && data.enrollments.find((e) => e.studentId === carlo.id && e.status === 'completed');
  const gradedBy = finished && byId(data.users, byId(data.sections, finished.sectionId)?.teacherId);
  if (finished) {
    for (const l of data.guardianLinks.filter((x) => x.studentId === carlo.id && x.status === 'active' && x.views?.grades)) {
      tell(byId(data.users, l.guardianId), gradedBy, 50, { system: 'lms', kind: 'grade.final', title: `${gradedBy?.name || 'The teacher'} gave ${carlo.name}'s final grade in ${sectionName(finished.sectionId)}`, body: 'See it under Grades', link: `/lms/#/children/${carlo.id}/grades` });
    }
  }

  // Academic: grade sheets waiting for the dean and the registrar; a teacher's sheet approved; document requests.
  for (const g of data.gradeSheets.filter((x) => x.demo)) {
    const s = byId(data.sections, g.sectionId);
    const teacher = s && byId(data.users, s.teacherId);
    const link = `/academic/#/grade-sheets/${g.sectionId}`;
    if (g.status === 'submitted') tell(dean, teacher, 3, { system: 'uis', kind: 'gradesheet.submitted', title: `${teacher?.name || 'A teacher'} submitted the grade sheet for ${sectionName(g.sectionId)}`, body: 'Waiting for your approval', link });
    if (g.status === 'approved') {
      tell(registrar, dean, 8, { system: 'uis', kind: 'gradesheet.approved', title: `${dean?.name || 'The dean'} approved the grade sheet for ${sectionName(g.sectionId)}`, body: 'Waiting for you to post it', link });
      tell(teacher, dean, 8, { system: 'uis', kind: 'gradesheet.approved', title: `${dean?.name || 'The dean'} approved your grade sheet for ${sectionName(g.sectionId)}`, body: 'The registrar posts it to the students\' records next', link });
    }
    if (g.status === 'posted' && teacher?.username === 'teacher.demo') tell(teacher, registrar, 70, { system: 'uis', kind: 'gradesheet.posted', title: `${registrar?.name || 'The registrar'} posted your grade sheet for ${sectionName(g.sectionId)}`, body: 'The grades are on the students\' records', link }, { read: true });
  }
  const DOC = Object.fromEntries(DOCUMENT_TYPES.map((x) => [x.id, x.label]));
  for (const r of data.documentRequests.filter((x) => x.demo)) {
    const st = byId(data.users, r.studentId);
    const doc = `${DOC[r.type] || 'document'} (${r.refNo})`;
    if (r.status === 'requested' && st?.username === 'student.demo') tell(registrar, st, 6, { system: 'uis', kind: 'request.filed', title: `${st.name} requested a ${DOC[r.type] || 'document'}`, body: `${r.refNo} · To be paid at the cashier`, link: '/academic/#/requests?status=open' });
    if (r.status === 'ready') tell(st, registrar, 20, { system: 'uis', kind: 'request.ready', title: `Your ${doc} is ready for release`, body: 'Claim it at the registrar\'s office', link: '/academic/#/me/requests' });
    if (r.status === 'processing') tell(st, registrar, 28, { system: 'uis', kind: 'request.processing', title: `The registrar is preparing your ${doc}`, body: 'You are told when it is ready', link: '/academic/#/me/requests' }, { read: true });
  }

  // People: requests waiting for HR, decisions on others', and the latest payslips.
  const what = (r) => `${plural(r.days, 'day')} of ${r.kind === 'leave' ? byId(data.leaveTypes, r.leaveTypeId)?.name || 'leave' : 'remote work'}`;
  let h = 2;
  for (const r of data.requests.filter((x) => x.demo)) {
    const mine = accountOfEmployee(data, r.employeeId);
    const by = byId(data.users, r.decidedBy) || hr;
    if (r.status === 'pending') tell(hr, mine, (h += 3), { system: 'hris', kind: 'request.filed', title: `${employeeName(r.employeeId)} asked for ${what(r)}`, body: `${fmtRange(r.startDate, r.endDate)} · Waiting for your approval`, link: '/hris/#/leave?tab=requests' });
    if (['approved', 'rejected'].includes(r.status) && mine) {
      const note = r.decisionNote ? ` · ${r.status === 'rejected' ? 'Reason' : 'Remarks'}: ${r.decisionNote}` : '';
      tell(mine, by, 60, { system: 'hris', kind: `request.${r.status}`, title: `${by?.name || 'HR'} ${r.status} your request for ${what(r)}`, body: `${fmtRange(r.startDate, r.endDate)}${note}`, link: '/hris/#/me/requests' }, { read: r.status === 'approved' });
    }
  }
  const run = data.payrollRuns.filter((r) => r.demo && r.status === 'finalized' && (!r.kind || r.kind === 'regular')).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
  if (run) {
    const payroll = byName('payroll.demo');
    for (const p of run.payslips) tell(accountOfEmployee(data, p.employeeId), payroll, 40, { system: 'hris', kind: 'payslip.ready', title: `Your payslip for ${fmtRange(run.periodStart, run.periodEnd)} is ready`, body: `Pay date ${fmtDay(run.payDate)} · Open it under My payslips`, link: `/hris/#/me/payslips/${run.id}` });
  }

  // Finance: what waits in each office's queue.
  const head = byName('head.demo');
  const card = (id) => byId(data.finCards, id)?.name || 'a payee';
  for (const p of data.finPrs.filter((x) => x.demo && x.status === 'submitted')) tell(head, byId(data.users, p.requestedBy?.userId), 7, { system: 'fmis', kind: 'pr.submitted', title: `${p.requestedBy?.name || 'An office'} submitted purchase request ${p.no}`, body: `${p.purpose} · Waiting for your approval`, link: `/finance/#/prs/${p.id}` });
  for (const d of data.finDvs.filter((x) => x.demo && x.status === 'certified')) tell(head, byId(data.users, d.certifiedBy?.id), 9, { system: 'fmis', kind: 'dv.certified', title: `${d.certifiedBy?.name || 'The accountant'} certified DV ${d.no} for ${card(d.payeeId)}`, body: 'Waiting for your approval (Box D)', link: `/finance/#/dvs/${d.id}` });
  for (const d of data.finDvs.filter((x) => x.demo && x.status === 'draft' && x.submitted)) tell(byName('accountant.demo'), byId(data.users, d.createdById), 4, { system: 'fmis', kind: 'dv.submitted', title: `${d.createdBy || 'The cashier'} submitted a disbursement voucher for ${card(d.payeeId)}`, body: 'Waiting for your certification (Box C)', link: `/finance/#/dvs/${d.id}` });
  for (const r of data.finRis.filter((x) => x.demo && x.status === 'requested')) tell(byName('supply.demo'), byId(data.users, r.requestedBy?.userId), 10, { system: 'fmis', kind: 'ris.requested', title: `${r.requestedBy?.name || 'An office'} asked for supplies (RIS ${r.no})`, body: `${r.purpose} · Waiting for the supply office`, link: `/finance/#/ris/${r.id}` });
}

// ----- The API: the signed-in account's own notifications -----
export function registerNotificationRoutes(route, { db, clock = () => new Date() }) {
  const d = () => db.data;
  const nowMs = () => clock().getTime();
  const userName = (id) => d().users.find((u) => u.id === id)?.name || null;
  const mine = (u) => {
    d().notifications = pruneNotifications(d().notifications || [], nowMs(), u.id);
    return d().notifications.filter((n) => n.userId === u.id);
  };
  const shape = (n) => ({ id: n.id, system: n.system, kind: n.kind, title: n.title, body: n.body, link: n.link, actorId: n.actorId, actorName: n.actorId ? userName(n.actorId) : null, at: n.at, readAt: n.readAt });
  const unreadOf = (u) => mine(u).filter((n) => !n.readAt).length;

  route('GET', '/api/me/notifications', 'me', ({ user: u, query }) => {
    // Newest first; written in the same second, the one written later first.
    const list = mine(u).map((n, i) => [n, i]).sort(([a, i], [b, j]) => b.at.localeCompare(a.at) || j - i).map(([n]) => n);
    const limit = Math.min(PAGE_MAX, Math.max(1, Number.parseInt(query.limit, 10) || 30));
    const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
    const system = NOTIFY_SYSTEM_IDS.includes(query.system) ? query.system : null;
    const picked = list.filter((n) => (!system || n.system === system) && (query.unread !== '1' || !n.readAt));
    return { unread: list.filter((n) => !n.readAt).length, items: picked.slice(offset, offset + limit).map(shape), more: picked.length > offset + limit };
  }, { audit: false });
  route('GET', '/api/me/notifications/count', 'me', ({ user: u }) => ({ unread: unreadOf(u) }), { audit: false });
  // Mark read: { ids: [...] } (the signed-in account's own; any other id is ignored) or { all: true }.
  // Reading is not a change to the school's data, so it is not in the audit trail.
  route('PUT', '/api/me/notifications/read', 'me', ({ user: u, body }) => {
    const at = clock().toISOString();
    let marked = 0;
    if (body.all === true) {
      for (const n of mine(u)) if (!n.readAt) (n.readAt = at), marked++;
    } else {
      const ids = body.ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > NOTIFY_KEEP || !ids.every((x) => typeof x === 'string' && x.length <= 80)) {
        fail(`Send the notifications to mark as read (1 to ${NOTIFY_KEEP}), or all.`);
      }
      const wanted = new Set(ids);
      for (const n of mine(u)) if (!n.readAt && wanted.has(n.id)) (n.readAt = at), marked++;
    }
    if (marked) db.save();
    return { marked, unread: unreadOf(u) };
  }, { audit: false, body: { ids: t.any(), all: t.any() } });
}
