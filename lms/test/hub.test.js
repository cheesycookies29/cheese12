import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, seed } from './support.js';

test('one sign-in: each account type lands on its own side', async () => {
  const env = setup();
  const { admin } = await seed(env);
  await admin.post('/api/admin/users', { role: 'registrar', username: 'reg', name: 'Reg', password: 'password123', mustChangePassword: false });

  const student = env.client();
  await student.post('/api/hub/login', { username: 'stud1', password: 'password123' });
  let s = await student.get('/api/hub/status');
  assert.equal(s.side, 'portal');
  assert.equal(s.authBase, '/api/auth');
  await student.get('/api/classes'); // the LMS session works without signing in again
  await assert.rejects(student.get('/api/admin/dashboard'), /admin panel/);

  const reg = env.client();
  await reg.post('/api/hub/login', { username: 'reg', password: 'password123' });
  s = await reg.get('/api/hub/status');
  assert.equal(s.side, 'admin');
  assert.equal(s.systems.find((x) => x.id === 'lms').url, '/admin');
  await reg.get('/api/admin/dashboard');

  await assert.rejects(env.client().post('/api/hub/login', { username: 'stud1', password: 'nope' }), /Incorrect username or password/);
  await assert.rejects(env.client().post('/api/hub/login', { username: 'ghost', password: 'nope' }), /Incorrect username or password/);
});

test('systems: LMS open, others coming soon, HRIS not shown to students', async () => {
  const env = setup();
  const { login } = await seed(env);
  const anon = await env.client().get('/api/hub/status');
  assert.deepEqual(anon.systems.map((x) => x.id), ['hris', 'fmis', 'uis', 'lms']);
  assert.ok(anon.systems.every((x) => x.url === ''), 'no addresses before signing in');

  const s = await (await login('stud1')).get('/api/hub/status');
  assert.deepEqual(s.systems.map((x) => [x.id, x.status]), [['fmis', 'soon'], ['uis', 'soon'], ['lms', 'live']]);
  assert.equal(s.systems.find((x) => x.id === 'lms').url, '/lms/');
  const t = await (await login('teach1')).get('/api/hub/status');
  assert.ok(t.systems.some((x) => x.id === 'hris'), 'teachers are employees');
});

test('admins switch a system live with its address, or hide it', async () => {
  const env = setup();
  const { admin, login } = await seed(env);
  const { settings } = await admin.get('/api/admin/systems');
  await assert.rejects(admin.put('/api/admin/systems', { settings: { ...settings, hris: { status: 'live', url: '' } } }), /give the address/);
  await assert.rejects(admin.put('/api/admin/systems', { settings: { ...settings, hris: { status: 'live', url: 'javascript:alert(1)' } } }), /must start with/);
  await admin.put('/api/admin/systems', { settings: { ...settings, hris: { status: 'live', url: 'http://localhost:3000' }, fmis: { status: 'hidden', url: '' } } });
  const t = await (await login('teach1')).get('/api/hub/status');
  const hris = t.systems.find((x) => x.id === 'hris');
  assert.deepEqual([hris.status, hris.url, hris.external], ['live', 'http://localhost:3000', true]);
  assert.equal(t.systems.some((x) => x.id === 'fmis'), false);
});

test('signing out of the portal signs out of every side', async () => {
  const env = setup();
  await seed(env);
  const c = env.client();
  await c.post('/api/hub/login', { username: 'admin', password: 'password123' });
  await c.post('/api/hub/logout');
  assert.equal((await c.get('/api/hub/status')).user, null);
  await assert.rejects(c.get('/api/admin/dashboard'), /sign in/);
});

test('portal feed follows the News & events module', async () => {
  const env = setup();
  const { admin, login } = await seed(env);
  await admin.post('/api/admin/news', { title: 'Hello' });
  const s1 = await login('stud1');
  assert.equal((await s1.get('/api/hub/feed')).news[0].title, 'Hello');
  const { config } = await admin.get('/api/admin/modules');
  config.news.student = false;
  await admin.put('/api/admin/modules', { config });
  assert.deepEqual((await s1.get('/api/hub/feed')).news, []);
  assert.equal((await admin.get('/api/hub/feed')).news.length, 1, 'administrators always see it');
});

test('a setup code protects the first administrator on a new server', async () => {
  const { memoryDb } = await import('../server/db.js');
  const { createApi } = await import('../server/api.js');
  const api = createApi(memoryDb(), { setupCode: 'orange-river-42' });
  const call = (method, path, body = {}) => api({ method, headers: {} }, new URL(`http://localhost${path}`), body);
  assert.equal((await call('GET', '/api/admin/auth/status')).data.setupCodeRequired, true);
  const form = { name: 'A', username: 'admin', password: 'password123' };
  await assert.rejects(call('POST', '/api/admin/auth/setup', form), /setup code is not correct/);
  await assert.rejects(call('POST', '/api/admin/auth/setup', { ...form, setupCode: 'wrong' }), /setup code is not correct/);
  await call('POST', '/api/admin/auth/setup', { ...form, setupCode: 'orange-river-42' });
  assert.equal((await call('GET', '/api/admin/auth/status')).data.setupCodeRequired, false);
});
