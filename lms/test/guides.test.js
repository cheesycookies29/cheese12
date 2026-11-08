// Help & guides: the guides stay in step with the software (every screen in a sidebar is covered,
// every screenshot exists), the format is valid, and administrators' edits are kept across updates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from './support.js';
import { ROLES } from '../shared/roles.js';
import { parseGuide, renderMarkdown, imagesOf } from '../shared/markdown.js';
import { guideFor } from '../shared/help.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDES = path.join(ROOT, 'docs', 'guides');
const files = fs.readdirSync(GUIDES).filter((f) => f.endsWith('.md') && f !== 'README.md');
const guides = files.map((f) => ({ file: f, ...parseGuide(fs.readFileSync(path.join(GUIDES, f), 'utf8')) }));
const byId = new Map(guides.map((g) => [g.meta.id, g]));
const APPS = { portal: 'learn', admin: 'admin', academic: 'academic', hris: 'people', finance: 'finance' };

// Sidebar labels of an app (every `label:` in its app.js nav).
function navLabels(app) {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', app, 'app.js'), 'utf8');
  const labels = new Set();
  for (const m of src.matchAll(/label:\s*((?:[^,'}\n]|'(?:[^'\\]|\\.)*')+)/g)) {
    for (const q of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) labels.add(q[1].replace(/\\'/g, "'"));
  }
  return [...labels];
}

test('every guide has a valid header and the guide sections', () => {
  assert.ok(guides.length >= 1);
  for (const g of guides) {
    const where = g.file;
    assert.equal(`${g.meta.id}.md`, g.file, `${where}: id must match the file name`);
    assert.ok(g.meta.title, `${where}: title`);
    assert.ok(g.meta.summary, `${where}: summary`);
    assert.ok(g.meta.roles.length, `${where}: roles`);
    for (const r of g.meta.roles) assert.ok(ROLES[r], `${where}: unknown role ${r}`);
    for (const a of g.meta.apps) assert.ok(['home', ...Object.values(APPS)].includes(a), `${where}: unknown app ${a}`);
    assert.doesNotMatch(g.body, /^# /m, `${where}: no # heading (the title is the header's)`);
    if (!['whats-new'].includes(g.meta.id)) {
      for (const h of ['## Before you start', '## Walkthrough', '## How to', '## Screens at a glance', '## Questions']) assert.match(g.body, new RegExp(`^${h}`, 'm'), `${where}: needs "${h}"`);
    }
  }
});

test('every screenshot a guide shows exists and is in screenshots.json (and nothing is left over)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(GUIDES, 'screenshots.json'), 'utf8'));
  const listed = new Set(manifest.map((s) => s.file));
  const used = new Set();
  for (const g of guides) {
    for (const img of imagesOf(g.body)) {
      used.add(img);
      assert.ok(listed.has(img), `${g.file}: ${img} is not in screenshots.json`);
      assert.ok(fs.existsSync(path.join(ROOT, 'public', 'help', 'img', img)), `${g.file}: ${img} has not been taken (npm run guides:screenshots -- ${img})`);
    }
  }
  for (const s of manifest) {
    assert.ok(used.has(s.file), `screenshots.json: ${s.file} is not shown by any guide`);
    assert.ok(s.user && s.url, `screenshots.json: ${s.file} needs user and url`);
  }
});

test('every screen in every sidebar is covered by a guide for that system', () => {
  const missing = [];
  for (const [dir, app] of Object.entries(APPS)) {
    const text = guides.filter((g) => g.meta.apps.includes(app)).map((g) => g.body.toLowerCase()).join('\n');
    for (const label of navLabels(dir)) if (!text.includes(label.toLowerCase())) missing.push(`${app}: "${label}"`);
  }
  assert.deepEqual(missing, [], `Screens with no guide: describe them in the guide for the people who use them (docs/guides).\n${missing.join('\n')}`);
});

test('the Help button finds a guide for every account type in every system', () => {
  for (const role of Object.keys(ROLES)) {
    for (const from of ['home', 'portal', 'admin', 'academic', 'hris', 'finance']) {
      const id = guideFor(from, role);
      assert.ok(byId.has(id), `${role} in ${from} → "${id}", which is not a guide`);
    }
    assert.ok(guides.some((g) => g.meta.roles.includes(role)), `no guide is written for ${roleLabel(role)}`);
  }
});
const roleLabel = (r) => ROLES[r]?.label || r;

test('guides are shown safely: no HTML or scripts, only web, mail and ATLAS links', () => {
  const out = renderMarkdown('Hi <img src=x onerror=alert(1)> [x](javascript:alert(1)) [y](https://example.org) [z](registrar#terms)\n\n![a](x.jpg)');
  assert.doesNotMatch(out, /<img src=x|<[^>]*\sonerror=|href="javascript/i);
  assert.match(out, /href="https:\/\/example.org"/);
  assert.match(out, /href="#\/registrar#terms"/);
  assert.match(out, /src="\/help\/img\/x.jpg"/);
});

test('guides: signed-in people read them; administrators edit, keep their version, see built-in updates, restore', async () => {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'password123' });
  await admin.post('/api/admin/users', { role: 'teacher', username: 'tess', name: 'Tess Teacher', password: 'password123', mustChangePassword: false, campusIds: [(await admin.get('/api/admin/campuses'))[0].id] });
  const anon = env.client();
  await assert.rejects(anon.get('/api/guides'), (e) => e.status === 401);
  const teacher = env.client();
  await teacher.post('/api/hub/login', { username: 'tess', password: 'password123' });
  const list = await teacher.get('/api/guides');
  assert.equal(list.canEdit, false);
  const id = list.guides[0].id;
  const g = await teacher.get(`/api/guides/${id}`);
  assert.ok(g.markdown.includes('title:'));
  await assert.rejects(teacher.put(`/api/guides/${id}`, { markdown: g.markdown + '\nmore' }), (e) => e.status === 403);
  // The administrator edits it: everyone sees the school's version.
  const mine = g.markdown.replace(/\n## /, '\n> **Note:** At our school, ask the registrar first.\n\n## ');
  await admin.put(`/api/guides/${id}`, { markdown: mine });
  const after = await teacher.get(`/api/guides/${id}`);
  assert.ok(after.markdown.includes('At our school'));
  assert.equal(after.edited, true);
  assert.equal(after.builtInChanged, false);
  // An update of ATLAS changes the built-in guide: the administrator is told, and can compare.
  env.db.data.guideEdits.find((e) => e.id === id).baseHash = 'older';
  const told = await admin.get(`/api/guides/${id}`);
  assert.equal(told.builtInChanged, true);
  assert.ok(told.builtInMarkdown.length > 0);
  // A school's own guide, then restoring the built-in one.
  await admin.put('/api/guides/campus-offices', { markdown: '---\nid: campus-offices\ntitle: Campus offices\nsummary: Where to go.\nroles: student\napps: home\n---\n\n## Before you start\nThe registrar is in room 101.' });
  assert.ok((await teacher.get('/api/guides')).guides.some((x) => x.id === 'campus-offices' && x.custom));
  await assert.rejects(admin.put('/api/guides/no-header', { markdown: 'no header' }), /title/);
  await admin.del(`/api/guides/${id}`);
  assert.equal((await teacher.get(`/api/guides/${id}`)).edited, false);
  // Search.
  const found = await teacher.get('/api/guides?q=registrar room');
  assert.ok(found.results.some((r) => r.id === 'campus-offices'));
});
