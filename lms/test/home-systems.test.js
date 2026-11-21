// Choosing a system, after CORE's home (docs/home-systems.md): the order (pinned first, then the
// others, then coming soon), pinning with the star (only systems you can open, saved on the
// account, kept through backup and restore), and the live figures on each card, worked out as the
// person through each system's own routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import { orderSystems, canOpen } from '../shared/systems.js';

const status = (code) => (e) => e.status === code;

test('order: pinned first in the order pinned, then the others, then coming soon', () => {
  const sys = [
    { id: 'uis', status: 'live', url: '/academic/' }, { id: 'lms', status: 'live', url: '/lms/' },
    { id: 'rex', status: 'soon', url: '' }, { id: 'hris', status: 'live', url: '/hris/' }, { id: 'fmis', status: 'live', url: '/finance/' },
  ];
  assert.deepEqual(orderSystems(sys).map((s) => s.id), ['uis', 'lms', 'hris', 'fmis', 'rex']);
  assert.deepEqual(orderSystems(sys, ['fmis', 'lms']).map((s) => s.id), ['fmis', 'lms', 'uis', 'hris', 'rex']);
  assert.deepEqual(orderSystems(sys, ['rex', 'gone']).map((s) => s.id), ['uis', 'lms', 'hris', 'fmis', 'rex'], 'a system you cannot open is never pinned first');
  assert.equal(canOpen({ status: 'live', url: '' }), false);
});

async function demoSchool() {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'password123' });
  await admin.post('/api/admin/demo');
  const as = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: 'demo1234' });
    return c;
  };
  return { env, admin, as };
}

test('pinning: only systems you can open, saved on the account, kept through a restore', async () => {
  const { env, admin, as } = await demoSchool();
  const student = await as('student.demo');
  assert.deepEqual(await student.put('/api/me/favorite-systems', { systems: ['fmis', 'lms', 'fmis'] }), { favoriteSystems: ['fmis', 'lms'] });
  assert.deepEqual((await (await as('student.demo')).get('/api/hub/status')).user.favoriteSystems, ['fmis', 'lms'], 'on another device too');
  await assert.rejects(student.put('/api/me/favorite-systems', { systems: ['hris'] }), status(400), 'students have no People');
  await assert.rejects(student.put('/api/me/favorite-systems', { systems: ['rex'] }), status(400), 'coming soon');
  await assert.rejects(student.put('/api/me/favorite-systems', { systems: 'lms' }), status(400));
  await assert.rejects(env.client().put('/api/me/favorite-systems', { systems: [] }), status(401));
  // Restore: known systems kept, others dropped.
  const backup = await admin.get('/api/admin/backup');
  backup.users.find((u) => u.username === 'student.demo').favoriteSystems = ['lms', 'nope', '__proto__'];
  backup.users.find((u) => u.username === 'teacher.demo').favoriteSystems = 'not a list';
  await admin.post('/api/admin/restore', backup);
  const by = (n) => env.db.data.users.find((u) => u.username === n);
  assert.deepEqual(by('student.demo').favoriteSystems, ['lms']);
  assert.ok(!('favoriteSystems' in by('teacher.demo')));
  // Unpinning everything removes the field.
  assert.deepEqual(await (await as('student.demo')).put('/api/me/favorite-systems', { systems: [] }), { favoriteSystems: [] });
  assert.ok(!('favoriteSystems' in by('student.demo')));
});

test('figures: each person sees numbers from their own work only', async () => {
  const { env, as } = await demoSchool();
  const fig = async (u) => (await as(u)).get('/api/hub/figures');
  const teacher = await fig('teacher.demo');
  assert.match(teacher.lms[0], /^\d+ sections? you teach$/);
  assert.ok(teacher.lms.some((x) => /to grade$/.test(x)));
  const student = await fig('student.demo');
  assert.match(student.lms[0], /class(es)? this term$/);
  assert.ok(student.fmis.some((x) => /official receipt|No receipts/.test(x)));
  assert.deepEqual(student.hris, [], 'no People for students');
  const registrar = await fig('registrar.demo');
  assert.ok(registrar.lms.some((x) => /enrollment requests? to review/.test(x)));
  assert.ok(registrar.uis.some((x) => /document requests? open/.test(x)));
  const hr = await fig('hr.demo');
  assert.ok(hr.hris.some((x) => /leave requests? waiting/.test(x)));
  assert.deepEqual(hr.fmis, [], 'HR cannot see Finance\'s queues');
  const parent = await fig('parent.demo');
  assert.match(parent.lms[0], /child(ren)? linked/);
  assert.deepEqual([parent.uis, parent.hris, parent.fmis], [[], [], []]);
  for (const f of [teacher, student, registrar, hr, parent]) for (const list of Object.values(f)) assert.ok(list.length <= 3);
  await assert.rejects(env.client().get('/api/hub/figures'), status(401));
});
