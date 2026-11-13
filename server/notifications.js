// Notifications for every account (the bell in the top bar). One row per person and event, in
// db.data.notifications, written by each module where something happens that someone else should
// know about: a request that needs their decision, a decision on their own request, a payslip, a
// ticket, equipment, a sales record they now own, an answer to their feedback. Project Management
// keeps its own notifications (pmNotifications, "For you" on My work); the bell shows both, and
// reading an item in either place marks the same record read.
//
// Every item belongs to one account: the API reads and changes only the signed-in account's own.
// Texts are written when the event happens and say only what the linked page shows the recipient.
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { noAudit } from './audit.js';
import { moduleOn } from '../shared/modules.js';

export const NOTIFY_MODULES = ['hr', 'assets', 'helpdesk', 'crm', 'projects', 'system'];
export const NOTIFY_KEEP = 200; // per person, newest kept
export const NOTIFY_DAYS = 60; // older ones are removed
export const TITLE_MAX = 160;
export const BODY_MAX = 300;
const LINK_MAX = 300;
const PAGE_MAX = 100;

// A link is a route inside CORE: "#/" and a path, with no spaces, quotes or angle brackets.
const LINK_RE = /^#\/[A-Za-z0-9\-._~/?=&%:,+]*$/;
export const validLink = (link) => typeof link === 'string' && link.length <= LINK_MAX && LINK_RE.test(link);

// One line of plain text, cut to `max` characters (with an ellipsis when cut).
export function clip(v, max) {
  const s = (v == null || typeof v === 'object' ? '' : String(v)).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
// A quoted snippet of someone's text, for a body: “…”.
export const quote = (text, max = 120) => `“${clip(text, max)}”`;

// Dates as the screens show them: "Dec 7, 2026"; a range "Dec 7, 2026 to Dec 9, 2026".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}
export const fmtRange = (a, b) => (!b || a === b ? fmtDay(a) : `${fmtDay(a)} to ${fmtDay(b)}`);
export const daysText = (n) => (n === 0.5 ? 'half a day' : `${n} day${n === 1 ? '' : 's'}`);

// Notifications older than 60 days go, and each person keeps their newest 200 (only `userId`'s
// are counted when given).
export function pruneNotifications(list, nowMs = Date.now(), userId = null) {
  const cutoff = new Date(nowMs - NOTIFY_DAYS * 86400000).toISOString();
  const kept = list.filter((n) => n.at >= cutoff);
  const per = new Map();
  for (const n of kept) if (!userId || n.userId === userId) per.set(n.userId, (per.get(n.userId) || 0) + 1);
  const over = [...per].filter(([, c]) => c > NOTIFY_KEEP);
  if (!over.length) return kept.length === list.length ? list : kept;
  const drop = new Set();
  for (const [id, c] of over) kept.filter((x) => x.userId === id).sort((a, b) => a.at.localeCompare(b.at)).slice(0, c - NOTIFY_KEEP).forEach((x) => drop.add(x));
  return kept.filter((x) => !drop.has(x));
}

// Older databases: the collection, and old rows pruned.
export function migrateNotifications(db) {
  let changed = false;
  if (!Array.isArray(db.data.notifications)) (db.data.notifications = []), (changed = true);
  const pruned = pruneNotifications(db.data.notifications);
  if (pruned !== db.data.notifications) (db.data.notifications = pruned), (changed = true);
  return changed;
}

// The account linked to an employee record (active only), or null.
export const accountOfEmployee = (db, employeeId) => (employeeId && db.data.users.find((u) => u.employeeId === employeeId && u.active)) || null;

// Tells `userIds` about an event. entry: { module, kind, title, body, link }; actorId: who did it
// (never told of their own action; anonymous: not shown either, where the page does not say who).
// Skips missing or disabled accounts and repeated ids. The caller saves the database. Returns the
// rows written.
export function notify(db, userIds, entry, { actorId = null, anonymous = false, at = new Date().toISOString(), demo = false } = {}) {
  if (!NOTIFY_MODULES.includes(entry.module)) throw new Error(`Notification module must be one of ${NOTIFY_MODULES.join(', ')}.`);
  if (!validLink(entry.link)) throw new Error('A notification links to a CORE page: a "#/" route.');
  const title = clip(entry.title, TITLE_MAX);
  if (!title) throw new Error('A notification needs a title.');
  const body = clip(entry.body, BODY_MAX);
  const kind = clip(entry.kind, 40) || entry.module;
  if (!Array.isArray(db.data.notifications)) db.data.notifications = [];
  const written = [];
  for (const userId of new Set(Array.isArray(userIds) ? userIds : [userIds])) {
    if (!userId || userId === actorId || !db.data.users.some((u) => u.id === userId && u.active)) continue;
    const row = { id: randomUUID(), userId, module: entry.module, kind, title, body, link: entry.link, actorId: anonymous ? null : actorId || null, at, readAt: null, ...(demo ? { demo: true } : {}) };
    db.data.notifications.push(row);
    written.push(row);
  }
  if (written.length) db.data.notifications = pruneNotifications(db.data.notifications);
  return written;
}

// An account that goes: its notifications go, and it is no longer named as the actor of others'.
export function forgetUser(db, userId) {
  db.data.notifications = (db.data.notifications || []).filter((n) => n.userId !== userId);
  for (const n of db.data.notifications) if (n.actorId === userId) n.actorId = null;
}

// ----- The API: the signed-in account's own notifications, from both stores -----
// pm: { list(user) → PM "For you" items (only projects the user can open), markRead(user, ids | 'all') }.
export function registerNotificationRoutes(route, db, { pm }) {
  const d = () => db.data;
  const userName = (id) => d().users.find((u) => u.id === id)?.name || null;
  // Modules the company turned off are hidden, except from administrators.
  const shown = (u, module) => u.role === 'admin' || moduleOn(d().modules, module);

  const general = (u) => {
    d().notifications = pruneNotifications(d().notifications || [], Date.now(), u.id);
    return d().notifications.filter((n) => n.userId === u.id && shown(u, n.module)).map((n) => ({
      id: `n:${n.id}`, module: n.module, kind: n.kind, title: n.title, body: n.body, link: n.link,
      actorId: n.actorId, actorName: n.actorId ? userName(n.actorId) : null, at: n.at, readAt: n.readAt,
    }));
  };
  // A PM item in the same shape: "Andrea Villanueva assigned you LMS-12 …", the comment (if any)
  // and the project under it, linking to the task or the project.
  const fromPm = (n) => {
    const [, text, said] = /^(.*?)(?::\s(“.*))?$/s.exec(n.text) || [null, n.text, null];
    const where = n.projectName;
    const task = n.taskId && n.taskTitle && !text.includes(n.taskTitle) ? `${n.taskKey} ${n.taskTitle}` : '';
    return {
      id: `pm:${n.id}`, module: 'projects', kind: n.kind, title: clip(`${n.actorName || 'Someone'} ${text}`, TITLE_MAX),
      body: clip([said, task, where].filter(Boolean).join(' · '), BODY_MAX),
      link: n.taskId ? `#/projects/${n.projectId}/tasks/${n.taskId}` : `#/projects/${n.projectId}`,
      actorId: n.actorId || null, actorName: n.actorName || null, at: n.at, readAt: n.readAt,
    };
  };
  const projectItems = (u) => (shown(u, 'projects') ? pm.list(u).map(fromPm) : []);
  const all = (u) => [...general(u), ...projectItems(u)].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const unreadOf = (u) => general(u).filter((n) => !n.readAt).length + projectItems(u).filter((n) => !n.readAt).length;

  route('GET', '/api/notifications', 'auth', ({ user: u, query }) => {
    const list = all(u);
    const limit = Math.min(PAGE_MAX, Math.max(1, Number.parseInt(query.limit, 10) || 30));
    const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
    const module = NOTIFY_MODULES.includes(query.module) ? query.module : null;
    const picked = list.filter((n) => (!module || n.module === module) && (query.unread !== '1' || !n.readAt));
    return { unread: list.filter((n) => !n.readAt).length, items: picked.slice(offset, offset + limit), more: picked.length > offset + limit };
  });
  route('GET', '/api/notifications/count', 'auth', ({ user: u }) => ({ unread: unreadOf(u) }));
  // Mark read: { ids: ["n:…", "pm:…"] } (the signed-in account's own; any other id is ignored) or { all: true }.
  route('PUT', '/api/notifications/read', 'auth', ({ user: u, body }) => {
    noAudit(); // reading is not a change to the company's data
    const at = new Date().toISOString();
    let marked = 0;
    if (body?.all === true) {
      for (const n of d().notifications) if (n.userId === u.id && !n.readAt) (n.readAt = at), marked++;
      marked += pm.markRead(u, 'all');
    } else {
      const ids = body?.ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > NOTIFY_KEEP || !ids.every((x) => typeof x === 'string' && x.length <= 80)) {
        throw new HttpError(400, `Send the notifications to mark as read (1 to ${NOTIFY_KEEP}), or all.`);
      }
      const mine = new Set(ids.filter((x) => x.startsWith('n:')).map((x) => x.slice(2)));
      const pmIds = ids.filter((x) => x.startsWith('pm:')).map((x) => x.slice(3));
      for (const n of d().notifications) if (n.userId === u.id && !n.readAt && mine.has(n.id)) (n.readAt = at), marked++;
      if (pmIds.length) marked += pm.markRead(u, pmIds);
    }
    if (marked) db.save();
    return { marked, unread: unreadOf(u) };
  });
}
