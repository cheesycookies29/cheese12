// Settings → Branding → Brand: "ATLAS" (the default) or "Our school, powered by ATLAS", where the
// school's short name and seal lead every system (shared/brand.js). A made-up school throughout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, seed } from './support.js';
import { brandName, productName, branded, brandedProducts, isSchoolBrand } from '../shared/brand.js';
import { themeColors, inkOn, readableOn, contrast, DARK_INK } from '../shared/themes.js';
import { SYSTEMS, systemName } from '../shared/systems.js';
import { SETTINGS } from '../shared/settings-catalog.js';

const SCHOOL = { mode: 'school', shortName: 'LA', theme: 'custom', color: '#126131', accent: '#ede344' };
const NAMES = ['Academic', 'Learn', 'People', 'Finance', 'Documents', 'Facilities'];

test('the brand helpers: ATLAS by default, the short name in school mode', () => {
  for (const b of [undefined, {}, { mode: 'atlas', shortName: 'LA' }, { mode: 'school', shortName: '  ' }]) {
    assert.equal(brandName(b), 'ATLAS');
    assert.equal(productName(b, 'Learn'), 'ATLAS Learn');
    assert.equal(isSchoolBrand(b), false);
  }
  const b = { mode: 'school', shortName: ' LA ' };
  assert.equal(brandName(b), 'LA');
  assert.equal(productName(b, 'People'), 'LA People');
  assert.equal(branded(b, 'ATLAS Learn · Admin'), 'LA Learn · Admin');
  assert.equal(branded(b, 'ATLAS · Sign in'), 'LA · Sign in');
  assert.equal(branded(b, 'ATLAS'), 'LA');
  assert.equal(branded(b, 'ATLASSIAN'), 'ATLASSIAN', 'only the word ATLAS at the start');
  assert.equal(branded(b, 'Admin panel'), 'Admin panel');
  assert.equal(branded({}, 'ATLAS Learn'), 'ATLAS Learn');
  assert.equal(brandedProducts(b, 'Keeps the books in ATLAS Finance, not ATLAS itself.'), 'Keeps the books in LA Finance, not ATLAS itself.');
  assert.equal(brandedProducts({}, 'In ATLAS Finance'), 'In ATLAS Finance');
  // Systems named after their product carry the brand; one with a name of its own keeps it.
  const rex = SYSTEMS.find((s) => s.id === 'rex');
  assert.equal(systemName(SYSTEMS.find((s) => s.id === 'lms'), b), 'LA Learn');
  assert.equal(systemName(rex, b), rex.name);
});

test('a light accent keeps text readable: dark text on it, a deeper shade as text on white', () => {
  assert.deepEqual(themeColors({ theme: 'custom', color: '#126131', accent: '#ede344' }), { brand: '#126131', accent: '#ede344' });
  assert.equal(themeColors({ theme: 'custom', color: '#126131' }).accent, '#c28618', 'no accent: ATLAS gold, as before');
  assert.equal(themeColors({ theme: 'green', accent: '#ede344' }).accent, '#ca8a04', 'a preset keeps its own accent');
  assert.equal(inkOn('#ede344'), DARK_INK);
  assert.ok(contrast('#ede344', DARK_INK) >= 4.5);
  assert.equal(inkOn('#1e3a5f'), '#ffffff');
  const deep = readableOn('#ede344', '#ffffff', 4.5);
  assert.ok(contrast(deep, '#ffffff') >= 4.5, `${deep} on white`);
  assert.ok(contrast('#ffffff', '#126131') >= 4.5, 'white on the green brand');
});

test('branding settings are checked: the mode, the short name it needs, the accent colour', async () => {
  const env = setup();
  const { admin } = await seed(env);
  const put = (branding) => admin.put('/api/admin/settings', { branding });
  await assert.rejects(put({ theme: 'maroon', mode: 'rebrand' }), /whose brand leads/);
  await assert.rejects(put({ theme: 'maroon', mode: 'school' }), /short name/);
  await assert.rejects(put({ theme: 'maroon', mode: 'school', shortName: '   ' }), /short name/);
  await assert.rejects(put({ theme: 'maroon', mode: 'school', shortName: 'L'.repeat(25) }), /too long/);
  await assert.rejects(put({ theme: 'maroon', mode: 'school', shortName: '<b>LA</b>' }), /cannot contain/);
  await assert.rejects(put({ theme: 'custom', color: '#126131', accent: 'yellow' }), /accent colour/);
  await assert.rejects(put({ theme: 'custom', color: '#126131', accent: '#ede34' }), /accent colour/);
  let b = (await admin.get('/api/admin/settings')).branding;
  assert.deepEqual([b.mode, b.shortName, b.accent], ['atlas', '', ''], 'nothing saved by a refused change');

  await put(SCHOOL);
  b = (await admin.get('/api/admin/settings')).branding;
  assert.deepEqual([b.mode, b.shortName, b.theme, b.color, b.accent], ['school', 'LA', 'custom', '#126131', '#ede344']);
  // A short name can be kept for later while ATLAS leads; a preset drops the custom accent.
  await put({ theme: 'green', mode: 'atlas' });
  b = (await admin.get('/api/admin/settings')).branding;
  assert.deepEqual([b.mode, b.shortName, b.accent], ['atlas', 'LA', '']);
  // Saving other branding without the new fields keeps them (older pages, the Settings center).
  await put({ ...SCHOOL });
  await put({ theme: 'custom', color: '#126131', tagline: 'Hello' });
  b = (await admin.get('/api/admin/settings')).branding;
  assert.deepEqual([b.mode, b.shortName, b.accent, b.tagline], ['school', 'LA', '#ede344', 'Hello']);
});

test('the default leaves every name as it was', async () => {
  const env = setup();
  await seed(env);
  const anon = await env.client().get('/api/hub/status');
  assert.equal(anon.branding.mode, 'atlas');
  assert.equal(anon.branding.brandName, 'ATLAS');
  assert.deepEqual(anon.systems.map((s) => s.name), [...NAMES.map((n) => `ATLAS ${n}`), 'REX Bookstore e-Reader']);
});

test('school mode: the branding goes out signed out, and the systems carry the school\'s name', async () => {
  const env = setup();
  const { admin, login } = await seed(env);
  const logo = 'data:image/png;base64,iVBORw0KGgo=';
  await admin.put('/api/admin/settings', { schoolName: 'Lancaster Academy', branding: { ...SCHOOL, logo } });

  // Signed out, on every sign-in page: the sign-in screens need the short name, seal and colours.
  for (const path of ['/api/hub/status', '/api/auth/status', '/api/admin/auth/status', '/api/hris/auth/status']) {
    const { branding: b } = await env.client().get(path);
    assert.equal(b.mode, 'school', path);
    assert.equal(b.shortName, 'LA', path);
    assert.equal(b.brandName, 'LA', path);
    assert.equal(b.schoolName, 'Lancaster Academy', path);
    assert.equal(b.logo, logo, path);
    assert.deepEqual([b.brand, b.accent], ['#126131', '#ede344'], path);
  }
  const anon = await env.client().get('/api/hub/status');
  assert.deepEqual(anon.systems.map((s) => s.name), [...NAMES.map((n) => `LA ${n}`), 'REX Bookstore e-Reader']);
  assert.deepEqual(anon.systems.map((s) => s.product).slice(0, 2), ['Academic', 'Learn'], 'the product word stays');
  const signedIn = await (await login('stud1')).get('/api/hub/status');
  assert.equal(signedIn.systems.find((s) => s.id === 'lms').name, 'LA Learn');
  // Messages that name the home page name the school's.
  await assert.rejects(env.client().post('/api/admin/auth/login', { username: 'stud1', password: 'password123' }), /LA home page/);

  // Back to ATLAS: every name as before.
  await admin.put('/api/admin/settings', { branding: { ...SCHOOL, logo, mode: 'atlas' } });
  const back = await env.client().get('/api/hub/status');
  assert.equal(back.branding.mode, 'atlas');
  assert.equal(back.branding.brandName, 'ATLAS');
  assert.deepEqual(back.systems.map((s) => s.name), [...NAMES.map((n) => `ATLAS ${n}`), 'REX Bookstore e-Reader']);
  await assert.rejects(env.client().post('/api/admin/auth/login', { username: 'stud1', password: 'password123' }), /ATLAS home page/);
});

test('the Settings center knows the new branding settings, their defaults and their changes', async () => {
  const env = setup();
  const { admin } = await seed(env);
  for (const path of ['mode', 'shortName', 'accent']) assert.ok(SETTINGS.some(([area, p]) => area === 'branding' && p === path), path);
  let c = await admin.get('/api/admin/config');
  const find = (path) => c.settings.find((s) => s.area === 'branding' && s.path === path);
  assert.deepEqual([find('mode').default, find('shortName').default, find('accent').default], ['atlas', '', '']);
  assert.equal(find('mode').changed, false);
  await admin.put('/api/admin/settings', { branding: SCHOOL });
  c = await admin.get('/api/admin/config');
  assert.deepEqual([find('mode').value, find('mode').changed, find('shortName').value, find('accent').value], ['school', true, 'LA', '#ede344']);
  const h = await admin.get('/api/admin/config/history?area=branding');
  const labels = h.entries[0].changes.map((x) => x.label);
  for (const l of ['Brand', 'School short name', 'Accent colour']) assert.ok(labels.includes(l), l);
  // An export carries them; restoring the defaults puts ATLAS back in front.
  const file = await admin.get('/api/admin/config/export');
  assert.deepEqual([file.areas.branding.mode, file.areas.branding.shortName], ['school', 'LA']);
  await admin.post('/api/admin/config/reset', { area: 'branding' });
  const b = (await env.client().get('/api/hub/status')).branding;
  assert.deepEqual([b.mode, b.brandName], ['atlas', 'ATLAS']);
});
