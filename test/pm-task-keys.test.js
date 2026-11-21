// Project keys and task links (0.52), like Jira's: a project has a key of three letters (chosen,
// or the first three letters of its name); its tasks are KEY-1, KEY-2 …; /t/KEY-12 opens the task
// for those on the project. A new key renames the tasks and the old one keeps working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';
import { migratePm } from '../server/projects.js';
import { suggestProjectKey, parseTaskKey, takenProjectKeys, PROJECT_KEY_RE } from '../shared/projects.js';

const PW = 'Correct-Horse-42';
function company() {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-keys-')), 'db.json'));
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
  return { db, handle, client };
}

test('a key is three letters: the first three of the name, or the next free choice', () => {
  assert.equal(suggestProjectKey('Learning management system, phase 2'), 'LEA');
  assert.equal(suggestProjectKey('Learning management system', new Set(['LEA'])), 'LMS', 'then the initials');
  assert.equal(suggestProjectKey('Año Nuevo payroll'), 'ANO', 'accents dropped');
  assert.match(suggestProjectKey('AI'), PROJECT_KEY_RE);
  assert.match(suggestProjectKey('2027'), PROJECT_KEY_RE, 'a name without letters still gets one');
  const taken = new Set(['LEA', 'LMS']);
  for (let i = 0; i < 40; i++) taken.add(suggestProjectKey('Learning management system', taken));
  assert.equal(taken.size, 42, 'never a key that is taken');
  assert.deepEqual(parseTaskKey(' lea-12 '), { prefix: 'LEA', number: 12 });
  assert.deepEqual(parseTaskKey('PRJ-0001-7'), { prefix: 'PRJ-0001', number: 7 });
  for (const bad of ['', 'LEA', 'LEA-', '-12', 'LE A-1', 'LEA-1x', '<b>-1']) assert.equal(parseTaskKey(bad), null, bad);
  assert.deepEqual([...takenProjectKeys([{ id: 'a', key: 'LEA', oldKeys: ['LMS'] }, { id: 'b', key: 'WAR' }], 'b')].sort(), ['LEA', 'LMS']);
});

test('task keys and links: chosen or made keys, KEY-n tasks, found by key for members only, renamed with the old key kept', async () => {
  const { db, handle, client } = company();
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  for (const [name, username, role] of [['Pia Manager', 'pia', 'pm'], ['Paolo Manager', 'paolo', 'pm']]) await admin('POST', '/api/users', { name, username, role, password: PW, mustChangePassword: false });
  const login = async (u) => {
    const c = client();
    await c('POST', '/api/auth/login', { username: u, password: PW });
    return c;
  };
  const [pia, paolo] = [await login('pia'), await login('paolo')];
  const start = localDate();

  // Made from the name; chosen (any case); refused when not three letters or taken.
  const lms = await pia('POST', '/api/pm/projects', { name: 'Learning management system', startDate: start });
  assert.equal(lms.key, 'LEA');
  assert.deepEqual(await pia('GET', `/api/pm/key-suggestion?name=${encodeURIComponent('Learning analytics')}`), { key: 'LAN' });
  const hr = await pia('POST', '/api/pm/projects', { name: 'Hospital HRIS', key: 'hrs', startDate: start });
  assert.equal(hr.key, 'HRS');
  for (const key of ['HR', 'HRSX', 'H1S', 'H-S']) assert.match((await pia('POST', '/api/pm/projects', { name: 'X', key, startDate: start })).error, /three letters, A to Z/, key);
  assert.match((await pia('POST', '/api/pm/projects', { name: 'Y', key: 'lea', startDate: start })).error, /The key LEA is taken/);

  // Tasks: KEY-1, KEY-2 …; found by key (any case), by those on the project only.
  const t1 = await pia('POST', `/api/pm/projects/${lms.id}/tasks`, { title: 'Requirements' });
  const t2 = await pia('POST', `/api/pm/projects/${lms.id}/tasks`, { title: 'Gradebook' });
  assert.deepEqual([t1.key, t2.key], ['LEA-1', 'LEA-2']);
  assert.deepEqual(await pia('GET', '/api/pm/tasks/by-key/lea-2'), { projectId: lms.id, taskId: t2.id, key: 'LEA-2' });
  const outsider = await paolo('GET', '/api/pm/tasks/by-key/LEA-2');
  const missing = await pia('GET', '/api/pm/tasks/by-key/LEA-99');
  assert.equal(outsider.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(outsider.error.replace('LEA-2', 'X'), missing.error.replace('LEA-99', 'X'), 'the same answer: nothing tells a project exists');
  assert.equal((await pia('GET', '/api/pm/tasks/by-key/not a key')).status, 404);
  assert.equal((await client()('GET', '/api/pm/tasks/by-key/LEA-1')).status, 401);

  // A new key: the tasks are renamed, the old key still finds them and stays reserved.
  const fresh = await pia('GET', `/api/pm/projects/${lms.id}`);
  const renamed = await pia('PUT', `/api/pm/projects/${lms.id}`, { key: 'LMS', version: fresh.version });
  assert.equal(renamed.key, 'LMS', renamed.error);
  assert.deepEqual((await pia('GET', `/api/pm/projects/${lms.id}/tasks`)).map((t) => t.key).sort(), ['LMS-1', 'LMS-2']);
  assert.equal((await pia('GET', '/api/pm/tasks/by-key/LEA-2')).taskId, t2.id, 'old links keep working');
  assert.equal((await pia('GET', '/api/pm/tasks/by-key/LMS-2')).key, 'LMS-2');
  assert.match((await pia('POST', '/api/pm/projects', { name: 'Z', key: 'LEA', startDate: start })).error, /taken/, 'the old key stays the project\'s');
  assert.equal((await pia('POST', `/api/pm/projects/${lms.id}/tasks`, { title: 'Next' })).key, 'LMS-3', 'numbering goes on');
  assert.ok(db.data.pmProjects.find((p) => p.id === lms.id).history.some((h) => h.field === 'key' && h.from === 'LEA' && h.to === 'LMS'));
  // An edit without a key keeps it; a copy gets its own.
  const again = await pia('GET', `/api/pm/projects/${lms.id}`);
  assert.equal((await pia('PUT', `/api/pm/projects/${lms.id}`, { name: 'Learning management system v2', version: again.version })).key, 'LMS');
  const copy = await pia('POST', `/api/pm/projects/${lms.id}/copy`, { name: 'Learning management system copy', startDate: start });
  assert.match(copy.key, PROJECT_KEY_RE);
  assert.notEqual(copy.key, 'LMS');
  assert.ok((await pia('GET', `/api/pm/projects/${copy.id}/tasks`)).every((t) => t.key.startsWith(`${copy.key}-`)));
  handle.monitor.stop();
});

test('projects from before keys get one: their tasks are renamed, old links and notifications follow', () => {
  const { db, handle } = company();
  const p = { id: 'p1', code: 'PRJ-0001', name: 'Warehouse payroll', taskSeq: 2, members: [], statuses: [], history: [] };
  db.data.pmProjects.push(p);
  db.data.pmTasks.push({ id: 't1', projectId: 'p1', key: 'PRJ-0001-1', history: [] }, { id: 't2', projectId: 'p1', key: 'PRJ-0001-2', history: [{ field: 'created', from: '', to: 'copied from PRJ-0001-1' }] });
  db.data.pmNotifications.push({ id: 'n1', projectId: 'p1', userId: 'u', text: 'moved PRJ-0001-2 to Done', at: new Date().toISOString() });
  migratePm(db);
  assert.equal(p.key, 'WAR');
  assert.deepEqual(db.data.pmTasks.filter((t) => t.projectId === 'p1').map((t) => t.key), ['WAR-1', 'WAR-2']);
  assert.equal(db.data.pmTasks.find((t) => t.id === 't2').history[0].to, 'copied from WAR-1');
  assert.equal(db.data.pmNotifications.find((n) => n.id === 'n1').text, 'moved WAR-2 to Done');
  assert.deepEqual(p.oldPrefixes, ['PRJ-0001']);
  assert.equal(migratePm(db), false, 'once only');
  handle.monitor.stop();
});

test('/t/KEY-n is the link to share: the server sends it into the app', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /\^\\\/t\\\/\(\[A-Za-z0-9-\]\{3,40\}\)/);
  assert.match(server, /Location: `\/#\/t\/\$\{taskKey\.toUpperCase\(\)\}`/);
  const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /\['\/t\/:key', taskLinkView, 'projects', 'projects'\]/);
});
