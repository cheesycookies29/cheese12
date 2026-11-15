// Comments written in the visual editor (0.30): stored as the same small Markdown as descriptions.
// @mentions are found in the comment's plain text (a username with _ is written escaped), the
// notification quotes the text without the marks, and nothing is cut short in silence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { modelToMarkdown, richToText, renderRich } from '../shared/richtext.js';

const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-comments-')), 'db.json'));
const handle = createApi(db);
const client = () => {
  let cookie = '';
  return async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res.data;
  };
};
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
async function account(username, name) {
  const u = await admin('POST', '/api/users', { name, username, role: 'pm', password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  c.id = u.id;
  return c;
}
const pia = await account('pia', 'Pia Manager');
const ana = await account('ana_reyes', 'Ana Reyes');
const p = await pia('POST', '/api/pm/projects', { name: 'Clinic rollout', type: 'Client', startDate: '2026-11-02' });
await pia('PUT', `/api/pm/projects/${p.id}/members`, { version: p.version, members: [{ userId: pia.id, role: 'manager' }, { userId: ana.id, role: 'member' }] });
const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Install servers' });
const T = (text, m = {}) => ({ text, ...m });

test('a formatted comment: the mention of a username with _ is found, and the notification quotes plain text', async () => {
  // What the editor writes for "@ana_reyes please check **the rack** first" (the _ escaped).
  const body = modelToMarkdown([{ t: 'p', c: [T('@ana_reyes please check '), T('the rack', { b: true }), T(' first')] }, { t: 'list', ordered: false, task: true, items: [{ c: [T('Power')], checked: true }] }]);
  assert.match(body, /@ana\\_reyes/);
  const c = await pia('POST', `/api/pm/tasks/${t.id}/comments`, { body });
  assert.equal(c.body, body, 'stored as written');
  const n = (await ana('GET', '/api/pm/notifications')).items.find((x) => x.kind === 'mentioned');
  assert.ok(n, 'Ana was mentioned');
  assert.match(n.text, /“@ana_reyes please check the rack first \[x\] Power”|“@ana_reyes please check the rack first/);
  assert.doesNotMatch(n.text, /\*\*|\\_/);
  // The project's recent activity shows it without the marks too.
  const one = await pia('GET', `/api/pm/projects/${p.id}`);
  const act = one.activity.find((a) => a.field === 'comment');
  assert.equal(act.to, '@ana_reyes please check the rack first Power');
});

test('comments: an empty comment is refused; over 4,000 characters is refused, not cut', async () => {
  await assert.rejects(pia('POST', `/api/pm/tasks/${t.id}/comments`, { body: '   ' }), /Write the comment/);
  await assert.rejects(pia('POST', `/api/pm/tasks/${t.id}/comments`, { body: 'a'.repeat(4001) }), /up to 4,000 characters/);
  const ok = await pia('POST', `/api/pm/tasks/${t.id}/comments`, { body: 'a'.repeat(4000) });
  assert.equal(ok.body.length, 4000);
});

test('richToText: marks dropped, escaped marks back as typed', () => {
  assert.equal(richToText('Hi @pm\\_demo, see **this** and \\*not\\* a\\\\b.'), 'Hi @pm_demo, see this and *not* a\\b.');
  // An older comment, written as plain text, still shows its lines.
  assert.equal(renderRich('Line one\nLine two <b>'), '<p>Line one<br />Line two &lt;b&gt;</p>');
});
