// School news (with reactions and comments) and events. Admins and registrars post
// from the admin panel; students and teachers read, react and comment in the portal.
// Each post or event is for one campus, or for every campus (campusId null).
import { randomUUID } from 'node:crypto';
import { HttpError, DATE_RE, text } from './util.js';
import { TIME_RE } from '../shared/schedule.js';
import { campusName } from './campus.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
export const REACTIONS = ['like', 'love', 'celebrate'];

export function registerNewsRoutes(route, ctx) {
  const { db, today } = ctx;
  const data = () => db.data;
  const save = () => db.save();
  const iso = () => new Date().toISOString();
  const findPost = (id) => data().news.find((n) => n.id === id) || fail('Post not found.', 404);

  const postView = (n, user) => ({
    ...n,
    reactions: Object.fromEntries(REACTIONS.map((r) => [r, (n.reactions?.[r] || []).length])),
    mine: user ? REACTIONS.filter((r) => n.reactions?.[r]?.includes(user.id)) : [],
    comments: (n.comments || []).map((c) => ({ ...c, own: user ? c.userId === user.id : false })),
  });
  const here = (campusId) => (x) => x.campusId == null || x.campusId === campusId;
  const withCampus = (x) => ({ ...x, campusName: x.campusId ? campusName(data(), x.campusId) : 'All campuses' });
  const sorted = (user, campusId) => data().news.filter(here(campusId)).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt.localeCompare(a.createdAt)).map((n) => withCampus(postView(n, user)));
  const upcoming = (campusId) => data().events.filter(here(campusId)).filter((e) => (e.endDate || e.startDate) >= today()).sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime || '').localeCompare(b.startTime || '')).map(withCampus);
  const findHere = (id, campusId) => {
    const n = findPost(id);
    if (!here(campusId)(n)) fail('Post not found.', 404);
    return n;
  };

  // ----- Portal -----
  route('GET', '/api/news', 'portal', ({ user, query, campusId }) => sorted(user, campusId).slice(0, Math.min(100, Number(query.limit) || 30)), { module: 'news', guardians: true });
  route('GET', '/api/events', 'portal', ({ query, campusId }) => (query.all === '1' ? data().events.filter(here(campusId)).sort((a, b) => b.startDate.localeCompare(a.startDate)).map(withCampus) : upcoming(campusId)), { module: 'news', guardians: true });

  route('POST', '/api/news/:id/react', 'portal', ({ user, params, body, campusId }) => {
    const n = findHere(params.id, campusId);
    if (!REACTIONS.includes(body.reaction)) fail('Unknown reaction.');
    n.reactions ||= {};
    const list = (n.reactions[body.reaction] ||= []);
    const i = list.indexOf(user.id);
    if (i >= 0) list.splice(i, 1);
    else list.push(user.id);
    save();
    return postView(n, user);
  }, { module: 'news', guardians: true });

  route('POST', '/api/news/:id/comments', 'portal', ({ user, params, body, campusId }) => {
    const n = findHere(params.id, campusId);
    if (n.commentsOff) fail('Comments are turned off for this post.');
    const c = { id: randomUUID(), userId: user.id, name: user.name, role: user.role, body: text(body.body, 2000), createdAt: iso() };
    if (!c.body) fail('Write a comment.');
    (n.comments ||= []).push(c);
    save();
    return postView(n, user);
  }, { module: 'news', guardians: true });

  route('DELETE', '/api/news/:id/comments/:cid', 'portal', ({ user, params }) => {
    const n = findPost(params.id);
    const c = (n.comments || []).find((x) => x.id === params.cid) || fail('Comment not found.', 404);
    if (c.userId !== user.id) fail('You can only delete your own comments.', 403);
    n.comments.splice(n.comments.indexOf(c), 1);
    save();
    return postView(n, user);
  }, { module: 'news', guardians: true });

  // ----- Admin panel -----
  // Registrars post for their campus; only administrators post to every campus.
  const campusFor = (b, user, campusId) => (b.allCampuses && user.role === 'admin' ? null : campusId);
  const editable = (x, user, campusId) => {
    if (x.campusId == null ? user.role !== 'admin' : x.campusId !== campusId) fail(x.campusId == null ? 'Only administrators can change posts for every campus.' : 'This belongs to another campus. Switch to it first.', 403);
    return x;
  };
  const postFields = (b) => {
    const p = { title: text(b.title, 200), body: text(b.body, 20000), pinned: Boolean(b.pinned), commentsOff: Boolean(b.commentsOff) };
    if (!p.title) fail('Give the post a title.');
    return p;
  };
  route('GET', '/api/admin/news', 'admin:news.manage', ({ user, campusId }) => sorted(null, campusId).map((n) => ({ ...n, own: n.authorId === user.id })));
  route('POST', '/api/admin/news', 'admin:news.manage', ({ user, body, campusId }) => {
    const n = { id: randomUUID(), ...postFields(body), campusId: campusFor(body, user, campusId), authorId: user.id, authorName: user.name, createdAt: iso(), reactions: {}, comments: [] };
    data().news.push(n);
    save();
    return n;
  });
  route('PUT', '/api/admin/news/:id', 'admin:news.manage', ({ user, params, body, campusId }) => {
    const n = editable(findPost(params.id), user, campusId);
    Object.assign(n, postFields(body), { campusId: campusFor(body, user, campusId), updatedAt: iso() });
    save();
    return n;
  });
  route('DELETE', '/api/admin/news/:id', 'admin:news.manage', ({ user, params, campusId }) => {
    const n = editable(findPost(params.id), user, campusId);
    data().news.splice(data().news.indexOf(n), 1);
    save();
    return { ok: true };
  });
  route('DELETE', '/api/admin/news/:id/comments/:cid', 'admin:news.manage', ({ params, campusId }) => {
    const n = findHere(params.id, campusId);
    n.comments = (n.comments || []).filter((c) => c.id !== params.cid);
    save();
    return { ok: true };
  });

  const eventFields = (b) => {
    const e = {
      title: text(b.title, 200), description: text(b.description, 5000), location: text(b.location, 200),
      startDate: b.startDate || '', endDate: b.endDate || b.startDate || '', startTime: b.startTime || '', endTime: b.endTime || '',
    };
    if (!e.title) fail('Give the event a title.');
    if (!DATE_RE.test(e.startDate) || !DATE_RE.test(e.endDate)) fail('Pick the event dates.');
    if (e.endDate < e.startDate) fail('The event must end on or after its start date.');
    for (const t of [e.startTime, e.endTime]) if (t && !TIME_RE.test(t)) fail('Times must be HH:MM.');
    return e;
  };
  route('GET', '/api/admin/events', 'admin:news.manage', ({ campusId }) => data().events.filter(here(campusId)).sort((a, b) => b.startDate.localeCompare(a.startDate)).map(withCampus));
  route('POST', '/api/admin/events', 'admin:news.manage', ({ user, body, campusId }) => {
    const e = { id: randomUUID(), ...eventFields(body), campusId: campusFor(body, user, campusId), createdBy: user.name, createdAt: iso() };
    data().events.push(e);
    save();
    return e;
  });
  route('PUT', '/api/admin/events/:id', 'admin:news.manage', ({ user, params, body, campusId }) => {
    const e = editable(data().events.find((x) => x.id === params.id) || fail('Event not found.', 404), user, campusId);
    Object.assign(e, eventFields(body), { campusId: campusFor(body, user, campusId) });
    save();
    return e;
  });
  route('DELETE', '/api/admin/events/:id', 'admin:news.manage', ({ user, params, campusId }) => {
    editable(data().events.find((x) => x.id === params.id) || fail('Event not found.', 404), user, campusId);
    data().events = data().events.filter((x) => x.id !== params.id);
    save();
    return { ok: true };
  });

  return { upcoming };
}
