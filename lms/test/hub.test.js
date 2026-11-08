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

test('ATLAS products: Academic, Learn and Finance open, Facilities and the REX Bookstore e-Reader coming soon, People not shown to students', async () => {
  const env = setup();
  const { login } = await seed(env);
  const anon = await env.client().get('/api/hub/status');
  assert.deepEqual(anon.systems.map((x) => x.id), ['uis', 'lms', 'hris', 'fmis', 'facilities', 'rex']);
  assert.deepEqual(anon.systems.map((x) => x.name), ['ATLAS Academic', 'ATLAS Learn', 'ATLAS People', 'ATLAS Finance', 'ATLAS Facilities', 'REX Bookstore e-Reader']);
  assert.ok(anon.systems.every((x) => x.url === ''), 'no addresses before signing in');

  const s = await (await login('stud1')).get('/api/hub/status');
  assert.deepEqual(s.systems.map((x) => [x.id, x.status]), [['uis', 'live'], ['lms', 'live'], ['fmis', 'live'], ['rex', 'soon']]);
  assert.equal(s.systems.find((x) => x.id === 'rex').url, '', 'the e-reader is coming soon: no address yet');
  assert.equal(s.systems.find((x) => x.id === 'fmis').url, '/finance/');
  assert.equal(s.systems.find((x) => x.id === 'uis').url, '/academic/');
  assert.equal(s.systems.find((x) => x.id === 'lms').url, '/lms/');
  const t = await (await login('teach1')).get('/api/hub/status');
  assert.ok(t.systems.some((x) => x.id === 'hris'), 'teachers are employees');
  assert.ok(t.systems.some((x) => x.id === 'facilities'), 'Facilities is for employees');
});

test('admins switch a system live with its address, or hide it', async () => {
  const env = setup();
  const { admin, login } = await seed(env);
  const { settings } = await admin.get('/api/admin/systems');
  await assert.rejects(admin.put('/api/admin/systems', { settings: { ...settings, facilities: { status: 'live', url: '' } } }), /give the address/);
  await assert.rejects(admin.put('/api/admin/systems', { settings: { ...settings, facilities: { status: 'live', url: 'javascript:alert(1)' } } }), /must start with/);
  await admin.put('/api/admin/systems', { settings: { ...settings, facilities: { status: 'live', url: 'http://localhost:3000' } } });
  let t = await (await login('teach1')).get('/api/hub/status');
  const fac = t.systems.find((x) => x.id === 'facilities');
  assert.deepEqual([fac.status, fac.url, fac.external], ['live', 'http://localhost:3000', true]);
  await admin.put('/api/admin/systems', { settings: { ...settings, facilities: { status: 'hidden', url: '' } } });
  t = await (await login('teach1')).get('/api/hub/status');
  // Finance is built in: always live, at /finance/.
  const fmis = t.systems.find((x) => x.id === 'fmis');
  assert.deepEqual([fmis.status, fmis.url, fmis.external], ['live', '/finance/', false]);
  // The HRIS is built in: always live, at /hris/.
  const hris = t.systems.find((x) => x.id === 'hris');
  assert.deepEqual([hris.status, hris.url, hris.external], ['live', '/hris/', false]);
  assert.equal(t.systems.some((x) => x.id === 'facilities'), false);
  // Academic is built in too, at /academic/.
  assert.deepEqual(t.systems.filter((x) => x.id === 'uis').map((x) => [x.status, x.url]), [['live', '/academic/']]);
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
