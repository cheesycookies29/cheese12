// School news (with reactions and comments) and events. Admins and registrars post
// from the admin panel; students and teachers read, react and comment in the portal.
import { randomUUID } from 'node:crypto';
import { HttpError, DATE_RE, text } from './util.js';
import { TIME_RE } from '../shared/schedule.js';

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
  const sorted = (user) => data().news.slice().sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt.localeCompare(a.createdAt)).map((n) => postView(n, user));
  const upcoming = () => data().events.filter((e) => (e.endDate || e.startDate) >= today()).sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime || '').localeCompare(b.startTime || ''));

  // ----- Portal -----
  route('GET', '/api/news', 'portal', ({ user, query }) => sorted(user).slice(0, Math.min(100, Number(query.limit) || 30)), { module: 'news' });
  route('GET', '/api/events', 'portal', ({ query }) => (query.all === '1' ? data().events.slice().sort((a, b) => b.startDate.localeCompare(a.startDate)) : upcoming()), { module: 'news' });

  route('POST', '/api/news/:id/react', 'portal', ({ user, params, body }) => {
    const n = findPost(params.id);
    if (!REACTIONS.includes(body.reaction)) fail('Unknown reaction.');
    n.reactions ||= {};
    const list = (n.reactions[body.reaction] ||= []);
    const i = list.indexOf(user.id);
    if (i >= 0) list.splice(i, 1);
    else list.push(user.id);
    save();
    return postView(n, user);
  }, { module: 'news' });

  route('POST', '/api/news/:id/comments', 'portal', ({ user, params, body }) => {
    const n = findPost(params.id);
    if (n.commentsOff) fail('Comments are turned off for this post.');
    const c = { id: randomUUID(), userId: user.id, name: user.name, role: user.role, body: text(body.body, 2000), createdAt: iso() };
    if (!c.body) fail('Write a comment.');
    (n.comments ||= []).push(c);
    save();
    return postView(n, user);
  }, { module: 'news' });

  route('DELETE', '/api/news/:id/comments/:cid', 'portal', ({ user, params }) => {
    const n = findPost(params.id);
    const c = (n.comments || []).find((x) => x.id === params.cid) || fail('Comment not found.', 404);
    if (c.userId !== user.id) fail('You can only delete your own comments.', 403);
    n.comments.splice(n.comments.indexOf(c), 1);
    save();
    return postView(n, user);
  }, { module: 'news' });

  // ----- Admin panel -----
  const postFields = (b) => {
    const p = { title: text(b.title, 200), body: text(b.body, 20000), pinned: Boolean(b.pinned), commentsOff: Boolean(b.commentsOff) };
    if (!p.title) fail('Give the post a title.');
    return p;
  };
  route('GET', '/api/admin/news', 'admin:news.manage', ({ user }) => sorted(null).map((n) => ({ ...n, own: n.authorId === user.id })));
  route('POST', '/api/admin/news', 'admin:news.manage', ({ user, body }) => {
    const n = { id: randomUUID(), ...postFields(body), authorId: user.id, authorName: user.name, createdAt: iso(), reactions: {}, comments: [] };
    data().news.push(n);
    save();
    return n;
  });
  route('PUT', '/api/admin/news/:id', 'admin:news.manage', ({ params, body }) => {
    const n = findPost(params.id);
    Object.assign(n, postFields(body), { updatedAt: iso() });
    save();
    return n;
  });
  route('DELETE', '/api/admin/news/:id', 'admin:news.manage', ({ params }) => {
    const n = findPost(params.id);
    data().news.splice(data().news.indexOf(n), 1);
    save();
    return { ok: true };
  });
  route('DELETE', '/api/admin/news/:id/comments/:cid', 'admin:news.manage', ({ params }) => {
    const n = findPost(params.id);
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
  route('GET', '/api/admin/events', 'admin:news.manage', () => data().events.slice().sort((a, b) => b.startDate.localeCompare(a.startDate)));
  route('POST', '/api/admin/events', 'admin:news.manage', ({ user, body }) => {
    const e = { id: randomUUID(), ...eventFields(body), createdBy: user.name, createdAt: iso() };
    data().events.push(e);
    save();
    return e;
  });
  route('PUT', '/api/admin/events/:id', 'admin:news.manage', ({ params, body }) => {
    const e = data().events.find((x) => x.id === params.id) || fail('Event not found.', 404);
    Object.assign(e, eventFields(body));
    save();
    return e;
  });
  route('DELETE', '/api/admin/events/:id', 'admin:news.manage', ({ params }) => {
    data().events = data().events.filter((x) => x.id !== params.id);
    save();
    return { ok: true };
  });

  return { upcoming };
}
