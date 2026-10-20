// Feedback: every signed-in user can send it and follow replies; administrators read
// all of it, set a status and reply.
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { ROLES } from '../shared/roles.js';
import { FEEDBACK_TYPES, FEEDBACK_AREAS, FEEDBACK_STATUS } from '../shared/feedback.js';

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const newestFirst = (list) => [...list].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export function registerFeedbackRoutes(route, db) {
  const all = () => db.data.feedback;
  const find = (id) => {
    const f = all().find((x) => x.id === id);
    if (!f) throw new HttpError(404, 'Feedback not found.');
    return f;
  };
  const nextNumber = () => `FB-${String(all().reduce((n, f) => Math.max(n, Number(f.number.slice(3)) || 0), 0) + 1).padStart(4, '0')}`;

  route('POST', '/api/feedback', 'auth', ({ user, body }) => {
    const f = {
      type: FEEDBACK_TYPES[body.type] ? body.type : null,
      area: FEEDBACK_AREAS[body.area] ? body.area : 'general',
      subject: str(body.subject, 120),
      message: str(body.message, 4000),
    };
    if (!f.type) throw new HttpError(400, 'Pick what kind of feedback this is.');
    if (!f.subject) throw new HttpError(400, 'Add a short subject.');
    if (f.message.length < 10) throw new HttpError(400, 'Describe your feedback in a sentence or two.');
    const recent = all().filter((x) => x.userId === user.id && Date.now() - new Date(x.createdAt) < 60 * 60 * 1000);
    if (recent.length >= 20) throw new HttpError(429, 'You have sent a lot of feedback in the last hour. Please try again later.');
    const now = new Date().toISOString();
    const entry = {
      id: randomUUID(), number: nextNumber(), ...f, status: 'new',
      userId: user.id, userName: user.name, username: user.username, role: user.role, roleLabel: ROLES[user.role]?.label || user.role,
      createdAt: now, updatedAt: now, updates: [],
    };
    all().push(entry);
    db.save();
    return entry;
  });

  // What this user sent, with the administrators' replies (but not who exactly is behind the "Administrator" label).
  route('GET', '/api/me/feedback', 'auth', ({ user }) => newestFirst(all().filter((f) => f.userId === user.id)));

  route('GET', '/api/feedback', 'feedback.view', () => newestFirst(all()));
  route('GET', '/api/feedback/summary', 'feedback.view', () => ({ new: all().filter((f) => f.status === 'new').length }));
  route('GET', '/api/feedback/:id', 'feedback.view', ({ params }) => find(params.id));

  // Change the status and/or reply; the sender sees both on their Feedback page.
  route('POST', '/api/feedback/:id/update', 'feedback.manage', ({ params, body, user }) => {
    const f = find(params.id);
    const status = FEEDBACK_STATUS[body.status] ? body.status : f.status;
    const note = str(body.note, 2000);
    if (status === f.status && !note) throw new HttpError(400, 'Change the status or write a reply.');
    f.updates.push({ at: new Date().toISOString(), by: user.name, status: status !== f.status ? status : null, note });
    f.status = status;
    f.updatedAt = new Date().toISOString();
    db.save();
    return f;
  });
  route('DELETE', '/api/feedback/:id', 'feedback.manage', ({ params }) => {
    const f = find(params.id);
    db.data.feedback = all().filter((x) => x.id !== f.id);
    db.save();
    return { ok: true };
  });
}
