// Help & guides: the guides stay in step with the software (every screen in a sidebar is covered,
// every screenshot exists), the format is valid, and administrators' edits are kept across updates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from './support.js';
import { ROLES } from '../shared/roles.js';
import { parseGuide, renderMarkdown, imagesOf, slug } from '../shared/markdown.js';
import { searchGuides, parseQuery, sectionsOf } from '../server/guide-search.js';
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
    assert.ok('user' in s && s.url, `screenshots.json: ${s.file} needs user (null for a signed-out screen) and url`);
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

test('guides look like documentation: menu paths, callouts, steps that go on after a screenshot, section links', () => {
  const out = renderMarkdown('## Do it\n\n1. Open **Admin panel → Terms**.\n\n![The list](x.jpg)\n\n2. Choose **Save**.\n\n> **Tip:** Keep *one* term open.', { guideId: 'admin' });
  assert.match(out, /<strong class="ui-path"><span>Admin panel<\/span><i aria-hidden="true">›<\/i><span>Terms<\/span><\/strong>/);
  assert.match(out, /<aside class="callout tip" role="note"><p class="callout-title">Tip<\/p><p>Keep <em>one<\/em> term open.<\/p><\/aside>/);
  assert.match(out, /<ol class="steps" start="2"/);
  assert.match(out, /<figure class="guide-shot">.*<figcaption>The list<\/figcaption>/);
  assert.match(out, /<h2 id="do-it">Do it <a class="anchor" href="#\/admin#do-it"/);
});

test('guides: signed-in people read them; administrators edit, keep their version, see built-in updates, restore', async () => {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'password123' });
  await admin.post('/api/admin/users', { role: 'teacher', username: 'tess', name: 'Tess Teacher', password: 'password123', mustChangePassword: false, campusIds: [(await admin.get('/api/admin/campuses'))[0].id] });
  // Signed out (the sign-in pages link to Help): only "Getting started" can be listed, read and searched.
  const anon = env.client();
  const open = await anon.get('/api/guides');
  assert.equal(open.signedIn, false);
  assert.deepEqual(open.guides.map((x) => x.id), ['getting-started']);
  assert.equal(open.canEdit, false);
  assert.ok((await anon.get('/api/guides/getting-started')).markdown.includes('## Questions'));
  await assert.rejects(anon.get('/api/guides/admin'), (e) => e.status === 401);
  assert.ok((await anon.get('/api/guides?q=payslip')).results.every((r) => r.id === 'getting-started'));
  await assert.rejects(anon.put('/api/guides/getting-started', { markdown: 'x' }), (e) => e.status === 401);
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
  const hit = found.results.find((r) => r.id === 'campus-offices');
  assert.equal(hit.section, 'Before you start');
  // Snippets are plain text: no list markers, bold or link syntax.
  const plainHit = (await teacher.get('/api/guides?q=grade sheet')).results.find((r) => r.id === 'teacher');
  assert.ok(plainHit.snippet && !/^[-*\d]|\*\*|\]\(/.test(plainHit.snippet), plainHit.snippet);
});

// ----- The guides hold together: links, lists and steps -----
test('every link between guides goes to a guide and a section that exist', () => {
  const sections = new Map(guides.map((g) => [g.meta.id, new Set([...g.body.matchAll(/^#{2,4}\s+(.+)$/gm)].map((m) => slug(m[1].trim())))]));
  const broken = [];
  for (const g of guides) {
    for (const m of g.body.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g)) {
      const url = m[2];
      if (/^(https?:|mailto:|\/)/.test(url)) continue;
      const [id, hash] = url.startsWith('#') ? [g.meta.id, url.slice(1)] : url.split('#');
      if (!sections.has(id)) broken.push(`${g.file}: [${m[1]}](${url}) → there is no guide "${id}"`);
      else if (hash && !sections.get(id).has(hash)) broken.push(`${g.file}: [${m[1]}](${url}) → ${id} has no section "#${hash}"`);
    }
  }
  assert.deepEqual(broken, [], `Broken links in the guides (a heading was renamed?):\n${broken.join('\n')}`);
});

test('guides use only what the Help page can show: lists one level deep, steps numbered in order, captions on pictures', () => {
  const problems = [];
  for (const g of guides) {
    let expect = 1;
    let section = '';
    g.body.split('\n').forEach((l, i) => {
      const at = `${g.file} line ${i + 1}`;
      if (/^\s{2,}([-*]|\d+[.)])\s+/.test(l)) problems.push(`${at}: a list inside a list is shown as running text; use a sentence, a table or separate steps`);
      if (/^!\[\s*\]\(/.test(l.trim())) problems.push(`${at}: a picture needs a caption (it is read aloud and shown under the picture)`);
      if (/^#{2,4}\s/.test(l)) {
        expect = 1;
        section = l.replace(/^#+\s*/, '');
        return;
      }
      const n = l.match(/^(\d+)[.)]\s/);
      if (!n) return;
      const k = Number(n[1]);
      if (k === 1) expect = 1;
      if (k !== expect) problems.push(`${at} ("${section}"): step ${k} where step ${expect} is expected`);
      expect = k + 1;
    });
    // Nothing of the Markdown is left over on the page.
    const text = renderMarkdown(g.body, { guideId: g.meta.id }).replace(/<code>[\s\S]*?<\/code>/g, '').replace(/<[^>]+>/g, ' ');
    const stray = text.match(/\*\*[^*\n]{1,60}\*\*|(?:^|\s)#{2,}\s\S+|\]\([^)\s]+\)/);
    if (stray) problems.push(`${g.file}: Markdown shown as text on the page: "${stray[0].trim()}"`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('tables are named by their columns (screen readers tell them apart)', () => {
  const out = renderMarkdown('| Screen | What it is for |\n|---|---|\n| **Home** | Start |\n\n| Tab | Shows |\n|---|---|\n| A | B |');
  assert.match(out, /aria-label="Table: Screen, What it is for"/);
  assert.match(out, /aria-label="Table: Tab, Shows"/);
});

// ----- Search -----
const searchable = (role) => guides.map((g) => ({ id: g.meta.id, title: g.meta.title, markdown: fs.readFileSync(path.join(GUIDES, g.file), 'utf8'), forYou: g.meta.roles.includes(role), order: g.meta.order }));
const top = (role, q) => searchGuides(searchable(role), q).results[0];

test('search: everyday words, parts of words, the reader\'s own guide first, questions found by their words', () => {
  assert.deepEqual(parseQuery('How do I log in?'), [['sign in']]);
  assert.deepEqual(parseQuery('my grades'), [['grades']]);
  assert.equal(parseQuery('salary')[0][0], 'salary');
  // Each question is found on its own.
  const q = sectionsOf(fs.readFileSync(path.join(GUIDES, 'getting-started.md'), 'utf8')).filter((s) => s.parent === 'Questions');
  assert.ok(q.length >= 5 && q.every((s) => s.anchor === 'questions' && s.heading));
  // "login" is "sign in" in the guides; "log in" does not match "catalog in".
  assert.deepEqual([top('student', 'login').id, top('student', 'login').section], ['getting-started', 'Sign in']);
  assert.ok(searchGuides(searchable('student'), 'log in').results.every((r) => /sign/i.test(r.section + r.snippet)));
  // The reader's own guide comes first, by the task that fits.
  assert.deepEqual([top('student', 'drop a class').id, top('student', 'drop a class').anchor], ['student', 'follow-withdraw-or-drop-a-request']);
  assert.equal(top('student', 'forgot my password').section, 'I forgot my password');
  assert.equal(top('student', 'tuition').id, 'student');
  assert.equal(top('staff', 'salary').id, 'employee');
  assert.equal(top('registrar', 'post final grades').id, 'registrar');
  assert.equal(top('registrar', 'enrolling students').section, 'Approve, reject or drop enrollments'); // enrolling → enroll, enrollments
  // The anchor of every result is a section of that guide.
  for (const r of searchGuides(searchable('admin'), 'password').results) {
    const anchors = [...byId.get(r.id).body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => slug(m[1].trim()));
    assert.ok(anchors.includes(r.anchor), `${r.id}#${r.anchor}`);
  }
  // Nothing found, and the closest when no section has every word.
  assert.deepEqual(searchGuides(searchable('student'), 'zzzz').results, []);
  const near = searchGuides(searchable('student'), 'payslip zzzz');
  assert.equal(near.partial, true);
  assert.ok(near.results.length > 0);
  // Words to highlight are the starts of words.
  assert.ok(searchGuides(searchable('student'), 'grades').terms.includes('grade'));
});
