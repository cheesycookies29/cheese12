// Feedback: every signed-in user can send it and follow replies; administrators read
// all of it, set a status and reply.
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { ROLES } from '../shared/roles.js';
import { FEEDBACK_TYPES, FEEDBACK_AREAS, FEEDBACK_STATUS } from '../shared/feedback.js';
import { notify, quote } from './notifications.js';
import { richToText, richWords } from '../shared/richtext.js';

// Text fields are text (QA 0.37): an object or a list is refused, not stored as "[object Object]".
const str = (v, max, what) => {
  if (v == null) return '';
  if (typeof v !== 'string') throw new HttpError(400, `Write the ${what} as text.`);
  return v.trim().slice(0, max);
};
// One of a list's own keys, never a name every object has (constructor, toString) or a list.
const oneOf = (list, v) => (typeof v === 'string' && Object.hasOwn(list, v) ? v : null);
const newestFirst = (list) => [...list].reverse().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
const numberOf = (f) => Number(String(f?.number || '').match(/^FB-(\d+)$/)?.[1]) || 0;

// Feedback as kept: a record from an old or hand-edited backup is filled in or left out, so one
// bad record cannot stop feedback for everyone (QA 0.37). Used when a backup is restored.
export function cleanFeedback(list) {
  if (!Array.isArray(list)) return [];
  const now = new Date().toISOString();
  const used = new Set();
  return list.filter((f) => f && typeof f === 'object' && typeof f.id === 'string' && f.id && !used.has(f.id) && used.add(f.id)).map((f) => ({
    ...f,
    number: typeof f.number === 'string' && /^FB-\d+$/.test(f.number) ? f.number : 'FB-0000',
    type: oneOf(FEEDBACK_TYPES, f.type) || 'other',
    area: oneOf(FEEDBACK_AREAS, f.area) || 'general',
    status: oneOf(FEEDBACK_STATUS, f.status) || 'new',
    subject: typeof f.subject === 'string' ? f.subject.slice(0, 120) : '',
    message: typeof f.message === 'string' ? f.message.slice(0, 4000) : '',
    createdAt: typeof f.createdAt === 'string' ? f.createdAt : now,
    updatedAt: typeof f.updatedAt === 'string' ? f.updatedAt : typeof f.createdAt === 'string' ? f.createdAt : now,
    updates: Array.isArray(f.updates) ? f.updates.filter((u) => u && typeof u === 'object').map((u) => ({
      at: typeof u.at === 'string' ? u.at : now, by: typeof u.by === 'string' ? u.by : '',
      status: oneOf(FEEDBACK_STATUS, u.status), note: typeof u.note === 'string' ? u.note.slice(0, 2000) : '',
    })) : [],
  }));
}

export function registerFeedbackRoutes(route, db, { audit } = {}) {
  const all = () => db.data.feedback;
  const find = (id) => {
    const f = all().find((x) => x.id === id);
    if (!f) throw new HttpError(404, 'Feedback not found.');
    return f;
  };
  // Numbers only go up: a deleted FB-0003 is never given to new feedback (QA 0.37). The highest
  // number given is kept beside the feedback; a restored backup starts after its own highest.
  const nextNumber = () => {
    const n = Math.max(Number(db.data.feedbackSeq) || 0, ...all().map(numberOf)) + 1;
    db.data.feedbackSeq = n;
    return `FB-${String(n).padStart(4, '0')}`;
  };
  const record = (action, f, opts) => audit?.record(action, { entity: 'feedback', entityId: f.id, label: `${f.number} · ${f.subject}`.slice(0, 200), ...opts });

  route('POST', '/api/feedback', 'auth', ({ user, body }) => {
    const f = {
      type: oneOf(FEEDBACK_TYPES, body.type),
      area: oneOf(FEEDBACK_AREAS, body.area) || 'general',
      subject: str(body.subject, 120, 'subject'),
      message: str(body.message, 4000, 'details'),
    };
    if (!f.type) throw new HttpError(400, 'Pick what kind of feedback this is.');
    if (!f.subject) throw new HttpError(400, 'Add a short subject.');
    // Written in the visual editor (0.35): stored as CORE's small Markdown; its words are what count.
    if (richWords(f.message).length < 10) throw new HttpError(400, 'Describe your feedback in a sentence or two.');
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
  // (VAPT 0.33: the replies go out without the administrator's name, not only hidden on the page.)
  route('GET', '/api/me/feedback', 'auth', ({ user }) => newestFirst(all().filter((f) => f.userId === user.id)).map((f) => ({ ...f, updates: (f.updates || []).map(({ at, status, note }) => ({ at, status, note })) })));

  route('GET', '/api/feedback', 'feedback.view', () => newestFirst(all()));
  route('GET', '/api/feedback/summary', 'feedback.view', () => ({ new: all().filter((f) => f.status === 'new').length }));
  route('GET', '/api/feedback/:id', 'feedback.view', ({ params }) => find(params.id));

  // Change the status and/or reply; the sender sees both on their Feedback page.
  route('POST', '/api/feedback/:id/update', 'feedback.manage', ({ params, body, user }) => {
    const f = find(params.id);
    if (body.status != null && !oneOf(FEEDBACK_STATUS, body.status)) throw new HttpError(400, 'Choose a status from the list.');
    const status = oneOf(FEEDBACK_STATUS, body.status) || f.status;
    // A reply is its words: formatting alone (an empty list) is no reply (0.36).
    const written = str(body.note, 2000, 'response');
    const note = richWords(written) ? written : '';
    if (status === f.status && !note) throw new HttpError(400, 'Change the status or write a reply.');
    const before = f.status;
    const changedStatus = status !== before;
    f.updates.push({ at: new Date().toISOString(), by: user.name, status: changedStatus ? status : null, note });
    f.status = status;
    f.updatedAt = new Date().toISOString();
    // The sender hears of it, the new status included. Their Feedback page says "Administrator",
    // not who: neither does this.
    const title = note
      ? `An administrator replied to your feedback ${f.number}${changedStatus ? ` and marked it ${FEEDBACK_STATUS[status]}` : ''}`
      : `An administrator marked your feedback ${f.number} as ${FEEDBACK_STATUS[status]}`;
    notify(db, [f.userId], {
      module: 'system', kind: 'feedback.reply', title,
      body: note ? `${f.subject}: ${quote(richToText(note), 200)}` : f.subject, link: `#/feedback?open=${f.id}`,
    }, { actorId: user.id, anonymous: true });
    db.save();
    // In the audit log (QA 0.37): who answered or changed what, never the text of the reply.
    record('feedback.update', f, { changes: changedStatus ? [{ field: 'status', from: FEEDBACK_STATUS[before] || before, to: FEEDBACK_STATUS[status] }] : [], note: note ? 'Response sent to the sender' : '' });
    return f;
  });
  route('DELETE', '/api/feedback/:id', 'feedback.manage', ({ params }) => {
    const f = find(params.id);
    db.data.feedback = all().filter((x) => x.id !== f.id);
    db.save();
    record('feedback.delete', f, { note: `From ${f.userName}; ${FEEDBACK_STATUS[f.status] || f.status}` });
    return { ok: true };
  });
}
