// Help & guides: the guides stay in step with the software (every screen in a sidebar is covered,
// every screenshot exists), the format is valid, and administrators' edits are kept across updates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLES } from '../shared/roles.js';
import { parseGuide, renderMarkdown, imagesOf } from '../shared/markdown.js';
import { guideFor } from '../shared/help.js';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDES = path.join(ROOT, 'docs', 'guides');
const files = fs.readdirSync(GUIDES).filter((f) => f.endsWith('.md') && f !== 'README.md');
const guides = files.map((f) => ({ file: f, ...parseGuide(fs.readFileSync(path.join(GUIDES, f), 'utf8')) }));
const byId = new Map(guides.map((g) => [g.meta.id, g]));
const MODULES = ['hr', 'assets', 'helpdesk', 'crm', 'projects', 'system'];

// Sidebar labels per module, from the NAV object in public/js/app.js.
function navLabels() {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  const nav = src.slice(src.indexOf('const NAV = {'), src.indexOf('\n};', src.indexOf('const NAV = {')));
  const out = {};
  let mod = null;
  for (const line of nav.split('\n')) {
    const m = line.match(/^ {2}(\w+): \[/);
    if (m) mod = m[1];
    const l = line.match(/label: '((?:[^'\\]|\\.)*)'/);
    if (mod && l) (out[mod] ||= []).push(l[1].replace(/\\'/g, "'"));
  }
  return out;
}

test('every guide has a valid header and the guide sections', () => {
  assert.ok(guides.length >= 8);
  for (const g of guides) {
    const where = g.file;
    assert.equal(`${g.meta.id}.md`, g.file, `${where}: id must match the file name`);
    assert.ok(g.meta.title, `${where}: title`);
    assert.ok(g.meta.summary, `${where}: summary`);
    assert.ok(g.meta.roles.length, `${where}: roles`);
    for (const r of g.meta.roles) assert.ok(ROLES[r], `${where}: unknown role ${r}`);
    for (const a of g.meta.apps) assert.ok(['home', ...MODULES].includes(a), `${where}: unknown module ${a}`);
    assert.doesNotMatch(g.body, /^# /m, `${where}: no # heading (the title is the header's)`);
    if (g.meta.id !== 'whats-new') {
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

test('every screen in every sidebar is covered by a guide for that module', () => {
  const missing = [];
  const labels = navLabels();
  // 'system' is the Admin panel's sidebar; 'common' is shown at the end of every module's menu.
  assert.deepEqual(Object.keys(labels).sort(), [...MODULES, 'common'].sort());
  for (const mod of MODULES) {
    const text = guides.filter((g) => g.meta.apps.includes(mod)).map((g) => g.body.toLowerCase()).join('\n');
    for (const label of labels[mod]) if (!text.includes(label.toLowerCase())) missing.push(`${mod}: "${label}"`);
  }
  const everyone = guides.filter((g) => g.meta.apps.includes('home')).map((g) => g.body.toLowerCase()).join('\n');
  for (const label of labels.common) if (!everyone.includes(label.toLowerCase())) missing.push(`every module: "${label}"`);
  assert.deepEqual(missing, [], `Screens with no guide: describe them in the guide for the people who use them (docs/guides).\n${missing.join('\n')}`);
});

test('the Help button finds a guide for every account type in every module', () => {
  for (const role of Object.keys(ROLES)) {
    for (const from of ['home', ...MODULES]) {
      const id = guideFor(from, role);
      assert.ok(byId.has(id), `${role} in ${from} → "${id}", which is not a guide`);
    }
    assert.ok(guides.some((g) => g.meta.roles.includes(role)), `no guide is written for ${ROLES[role].label}`);
  }
});

test('guides are shown safely: no HTML or scripts, only web, mail and CORE links', () => {
  const out = renderMarkdown('Hi <img src=x onerror=alert(1)> [x](javascript:alert(1)) [y](https://example.org) [z](hr#leave)\n\n![a](x.jpg)');
  assert.doesNotMatch(out, /<img src=x|<[^>]*\sonerror=|href="javascript/i);
  assert.match(out, /href="https:\/\/example.org"/);
  assert.match(out, /href="#\/hr#leave"/);
  assert.match(out, /src="\/help\/img\/x.jpg"/);
});

test('guides look like documentation: menu paths, callouts, steps that go on after a screenshot, section links', () => {
  const out = renderMarkdown('## Do it\n\n1. Open **HR & Payroll → Payroll**.\n\n![The list](x.jpg)\n\n2. Choose **Save**.\n\n> **Tip:** Keep *one* run open.', { guideId: 'payroll' });
  assert.match(out, /<strong class="ui-path"><span>HR &amp; Payroll<\/span><i aria-hidden="true">›<\/i><span>Payroll<\/span><\/strong>/);
  assert.match(out, /<aside class="callout tip" role="note"><p class="callout-title">Tip<\/p><p>Keep <em>one<\/em> run open.<\/p><\/aside>/);
  assert.match(out, /<ol class="steps" start="2"/);
  assert.match(out, /<figure class="guide-shot">.*<figcaption>The list<\/figcaption>/);
  assert.match(out, /<h2 id="do-it">Do it <a class="anchor" href="#\/payroll#do-it"/);
});

test('guides: signed-in people read them; administrators edit, keep their version, see built-in updates, restore', async () => {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-guides-')), 'db.json'));
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
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'Guide-Shots-2026' });
  await admin('POST', '/api/users', { name: 'Hana HR', username: 'hana', role: 'hr', password: 'Guide-Shots-2026', mustChangePassword: false });
  await assert.rejects(client()('GET', '/api/guides'), /sign in/i);
  const hr = client();
  await hr('POST', '/api/auth/login', { username: 'hana', password: 'Guide-Shots-2026' });
  const list = await hr('GET', '/api/guides');
  assert.equal(list.canEdit, false);
  assert.ok(list.guides.find((g) => g.id === 'hr').forYou);
  const g = await hr('GET', '/api/guides/hr');
  assert.ok(g.markdown.includes('title:'));
  await assert.rejects(hr('PUT', '/api/guides/hr', { markdown: `${g.markdown}\nmore` }), /does not have access/);
  // The administrator edits it: everyone sees the company's version.
  const mine = g.markdown.replace(/\n## /, '\n> **Note:** At LTDC, ask Maria first.\n\n## ');
  await admin('PUT', '/api/guides/hr', { markdown: mine });
  const after = await hr('GET', '/api/guides/hr');
  assert.ok(after.markdown.includes('ask Maria first'));
  assert.equal(after.edited, true);
  assert.equal(after.builtInChanged, false);
  // An update of CORE changes the built-in guide: the administrator is told, and can compare.
  db.data.guideEdits.find((e) => e.id === 'hr').baseHash = 'older';
  const told = await admin('GET', '/api/guides/hr');
  assert.equal(told.builtInChanged, true);
  assert.ok(told.builtInMarkdown.length > 0);
  // A company guide of its own, then restoring the built-in one.
  await admin('PUT', '/api/guides/office-rules', { markdown: '---\nid: office-rules\ntitle: Office rules\nsummary: Where to go.\nroles: employee\napps: home\n---\n\n## Before you start\nThe HR office is in room 3201.' });
  assert.ok((await hr('GET', '/api/guides')).guides.some((x) => x.id === 'office-rules' && x.custom));
  await assert.rejects(admin('PUT', '/api/guides/no-header', { markdown: 'no header' }), /title/);
  await admin('DELETE', '/api/guides/hr');
  assert.equal((await hr('GET', '/api/guides/hr')).edited, false);
  // Search, with plain-text snippets.
  const found = await hr('GET', `/api/guides?q=${encodeURIComponent('hr office room')}`);
  assert.equal(found.results.find((r) => r.id === 'office-rules').section, 'Before you start');
  const plainHit = (await hr('GET', `/api/guides?q=${encodeURIComponent('payroll run')}`)).results[0];
  assert.ok(plainHit.snippet && !/^[-*\d]|\*\*|\]\(/.test(plainHit.snippet), plainHit.snippet);
  // Edits are in the audit log.
  const log = (await admin('GET', '/api/audit?area=system')).entries.filter((e) => e.action === 'system.guide');
  assert.equal(log.length, 3);
});
