// Task comments (0.58): threads of replies (one level), emoji reactions from a fixed set, editing
// your own comment, and a deleted comment that keeps its thread's place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';
import { REACTIONS } from '../shared/projects.js';

const PW = 'Correct-Horse-42';

test('threads, reactions, edits and deletes on a task\'s comments', async () => {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-comments-')), 'db.json'));
  const handle = createApi(db);
  const client = () => {
    let cookie = '';
    return async (method, url, body = {}) => {
      try {
        const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.5' } }, new URL(url, 'http://localhost'), body);
        if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
        return res.data;
      } catch (err) {
        return { status: err.status, error: err.message };
      }
    };
  };
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const users = {};
  for (const [name, username, role] of [['Pia Manager', 'pia', 'pm'], ['Marco Member', 'marco', 'pm'], ['Vic Viewer', 'vic', 'pm'], ['Olga Outside', 'olga', 'pm']]) users[username] = await admin('POST', '/api/users', { name, username, role, password: PW, mustChangePassword: false });
  const login = async (u) => {
    const c = client();
    await c('POST', '/api/auth/login', { username: u, password: PW });
    return c;
  };
  const [pia, marco, vic, olga] = await Promise.all(['pia', 'marco', 'vic', 'olga'].map(login));
  const p = await pia('POST', '/api/pm/projects', { name: 'Learning management system', startDate: localDate(), members: [{ userId: users.marco.id, role: 'member' }, { userId: users.vic.id, role: 'viewer' }] });
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Gradebook import' });
  const base = `/api/pm/tasks/${t.id}/comments`;
  const notesOf = (who) => db.data.pmNotifications.filter((n) => n.userId === users[who].id).map((n) => n.text);

  // A comment, and a thread of replies under it; a reply to a reply joins the same thread.
  const root = await pia('POST', base, { body: 'Can someone check the cross-enrolled students?' });
  assert.equal(root.parentId, null);
  const r1 = await marco('POST', base, { body: 'Checked 32 of them.', parentId: root.id });
  assert.equal(r1.parentId, root.id);
  const r2 = await pia('POST', base, { body: 'Thanks!', parentId: r1.id });
  assert.equal(r2.parentId, root.id, 'a reply to a reply joins the thread');
  assert.equal((await marco('POST', base, { body: 'x', parentId: '00000000-0000-0000-0000-000000000000' })).status, 400);
  assert.ok(notesOf('pia').some((x) => /^replied on LEA-1: “Checked 32 of them\.”/.test(x)), 'whoever started the thread hears of a reply');
  assert.ok(notesOf('marco').some((x) => /^replied on LEA-1: “Thanks!”/.test(x)), 'and whoever replied in it');

  // Reactions: from the fixed set, one each per person, a second click takes it away.
  const rx = (who, emoji) => who('PUT', `/api/pm/comments/${root.id}/reactions`, { emoji });
  await rx(marco, '👍');
  await rx(vic, '👍');
  let out = await rx(pia, '🎉');
  assert.deepEqual(out.reactions.map((r) => [r.emoji, r.count, r.mine]), [['👍', 2, false], ['🎉', 1, true]]);
  assert.deepEqual(out.reactions[0].names.sort(), ['Marco Member', 'Vic Viewer']);
  out = await rx(marco, '👍');
  assert.deepEqual(out.reactions.map((r) => [r.emoji, r.count]), [['👍', 1], ['🎉', 1]], 'the second click takes it away');
  assert.equal((await rx(marco, '💩')).status, 400, 'only the set');
  assert.equal((await rx(marco, '<img src=x>')).status, 400);
  assert.equal((await rx(olga, '👍')).status, 404, 'not for someone outside the project');
  assert.equal(REACTIONS.length, 8);

  // Editing: your own only; "edited" is kept; nobody is notified again.
  const before = db.data.pmNotifications.length;
  const ed = await marco('PUT', `/api/pm/comments/${r1.id}`, { body: 'Checked all 40 of them.' });
  assert.equal(ed.body, 'Checked all 40 of them.');
  assert.ok(ed.editedAt);
  assert.equal(db.data.pmNotifications.length, before);
  assert.equal((await pia('PUT', `/api/pm/comments/${r1.id}`, { body: 'Not mine' })).status, 403, 'not someone else\'s, even as a manager');
  assert.equal((await marco('PUT', `/api/pm/comments/${r1.id}`, { body: '   ' })).status, 400);

  // The list: oldest first, each with its thread, reactions and who may do what.
  let list = await marco('GET', base);
  assert.deepEqual(list.map((c) => [c.body, c.parentId === root.id, c.canEdit]), [['Can someone check the cross-enrolled students?', false, false], ['Checked all 40 of them.', true, true], ['Thanks!', true, false]]);

  // Deleting the comment that started a thread: "Comment deleted" stays while replies do.
  assert.equal((await marco('DELETE', `/api/pm/comments/${root.id}`)).status, 403);
  await pia('DELETE', `/api/pm/comments/${root.id}`);
  list = await marco('GET', base);
  assert.deepEqual(list[0], { id: root.id, taskId: t.id, parentId: null, deleted: true, createdAt: root.createdAt, reactions: [], body: '', userName: '', userId: null, canDelete: false, canEdit: false });
  assert.equal(list.length, 3);
  assert.equal((await rx(marco, '👍')).status, 400, 'no reactions on a deleted comment');
  assert.equal((await marco('PUT', `/api/pm/comments/${root.id}`, { body: 'back' })).status, 403);
  assert.ok(!JSON.stringify(db.data.pmComments.find((c) => c.id === root.id)).includes('cross-enrolled'), 'its text is gone from the database');
  // The last reply gone: the deleted comment goes with it.
  await marco('DELETE', `/api/pm/comments/${r1.id}`);
  await pia('DELETE', `/api/pm/comments/${r2.id}`);
  assert.deepEqual(await marco('GET', base), []);
  // The project's activity leaves deleted comments out.
  const again = await pia('POST', base, { body: 'Back to it.' });
  const reply = await marco('POST', base, { body: 'Yes.', parentId: again.id });
  await pia('DELETE', `/api/pm/comments/${again.id}`);
  const act = (await pia('GET', `/api/pm/projects/${p.id}`)).activity.filter((a) => a.field === 'comment').map((a) => a.to);
  assert.deepEqual(act, ['Yes.']);
  assert.ok(reply.id);
  handle.monitor.stop();
});
