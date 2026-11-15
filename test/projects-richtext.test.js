// Task descriptions with formatting and pictures (0.21): the renderer never lets HTML or scripts
// through, the toolbar's edits do what they say, and pictures are images only, shown only to those
// who can open the project, removed when the description stops using them, and copied with a task.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';
import { addDays } from '../shared/projects.js';
import {
  renderRich, richToText, imageIdsOf, safeUrl, RICH_MAX, modelToMarkdown, inlineToMarkdown, escapeMd,
} from '../shared/richtext.js';

// ===== The renderer =====
test('formatting: emphasis, code, headings, lists, quotes, lines and links', () => {
  const out = renderRich('# Plan\n**bold** *it* _also_ ~~old~~ `a<b`\n\n- one\n- two\n\n3. three\n4. four\n\n> said\n> twice\n\n---\n\n```\n<x>\n```\n[CORE](https://example.com/a?b=1&c=2) and https://example.org/x.');
  assert.match(out, /<h3>Plan<\/h3>/);
  assert.match(out, /<strong>bold<\/strong> <em>it<\/em> <em>also<\/em> <del>old<\/del> <code>a&lt;b<\/code>/);
  assert.match(out, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(out, /<ol start="3"><li>three<\/li><li>four<\/li><\/ol>/);
  assert.match(out, /<blockquote><p>said<br \/>twice<\/p><\/blockquote>/);
  assert.match(out, /<hr \/>/);
  assert.match(out, /<pre><code>&lt;x&gt;<\/code><\/pre>/);
  assert.match(out, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">CORE<\/a>/);
  assert.match(out, /<a href="https:\/\/example\.org\/x" [^>]+>https:\/\/example\.org\/x<\/a>\./, 'a bare address is a link, without the full stop');
});

test('plain descriptions written before formatting read the same: line breaks kept', () => {
  assert.equal(renderRich('Line one\nLine two\n\nNew paragraph'), '<p>Line one<br />Line two</p>\n<p>New paragraph</p>');
  assert.equal(renderRich('snake_case and 2*3*4 stay as they are'), '<p>snake_case and 2*3*4 stay as they are</p>');
});

test('no HTML, scripts or unsafe links get through', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[click](javascript:alert(1))',
    '[click](JaVaScRiPt:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD4=)',
    '[x](//evil.example)',
    '[x](https://ok.example" onmouseover="alert(1))',
    '**<b onclick=x>**',
    '`</code><script>x</script>`',
    '![a" onerror="alert(1)](img:11111111-1111-1111-1111-111111111111)',
    '<svg/onload=alert(1)>',
    '> <iframe src=x>',
    '# <style>body{}</style>',
    'https://x.example/"><script>',
    '[<img src=x onerror=1>](https://ok.example)',
  ];
  for (const a of attacks) {
    const out = renderRich(a, { image: () => '/api/pm/tasks/t/images/i' });
    assert.doesNotMatch(out, /<(script|iframe|style|svg|b |img src=x)/i, a);
    assert.doesNotMatch(out, /\son\w+="/i, a);
    assert.doesNotMatch(out, /href="(?!https?:|mailto:|\/api\/pm\/tasks\/)/i, a);
  }
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('https://ok.example/p'), 'https://ok.example/p');
  assert.equal(safeUrl('mailto:a@b.example'), 'mailto:a@b.example');
});

test('pictures: only the task\'s own, by id, on a line of their own; others say "not found"', () => {
  const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
  const other = '11111111-2222-4333-8444-555555555555';
  const image = (x) => (x === id ? `/api/pm/tasks/T/images/${x}` : null);
  const out = renderRich(`Before\n![Wiring diagram](img:${id})\n![Gone](img:${other})\n![x](https://evil.example/a.png)`, { image });
  assert.match(out, new RegExp(`<figure class="rich-img"><a href="/api/pm/tasks/T/images/${id}"[^>]*><img src="/api/pm/tasks/T/images/${id}" alt="Wiring diagram" loading="lazy" /></a><figcaption>Wiring diagram</figcaption></figure>`));
  assert.match(out, /<p class="rich-missing">Picture not found: Gone<\/p>/);
  assert.doesNotMatch(out, /<img src="https:/, 'no pictures from other sites (at most a link)');
  assert.deepEqual(imageIdsOf(`![a](img:${id}) ![b](img:${other}) ![c](img:${id})`), [id, other]);
  assert.equal(richToText(`**Do** this: ![Plan](img:${id}) [docs](https://d.example)`), 'Do this: [Plan] docs (https://d.example)');
});




// ===== Pictures through the API =====
function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-rich-'));
  const db = openDb(path.join(dir, 'db.json'));
  const handle = createApi(db);
  const client = () => {
    let cookie = '';
    const c = async (method, url, body = {}) => {
      const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      return res.data;
    };
    c.raw = async (method, url, body = {}) => handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    return c;
  };
  return { db, dir, client };
}
const { db, dir, client } = server();
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
let empNo = 0;
async function account(username, role, name) {
  const [firstName, lastName] = name.split(' ');
  const employeeId = role === 'employee' ? (await admin('POST', '/api/employees', { employeeNo: `E-${++empNo}`, firstName, lastName, hireDate: '2020-01-01', payType: 'monthly', rate: 30000 })).id : null;
  const u = await admin('POST', '/api/users', { name, username, role, employeeId, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  c.id = u.id;
  return c;
}
const pia = await account('pia', 'pm', 'Pia Manager');
const juan = await account('juan', 'employee', 'Juan Cruz');
const vic = await account('vic', 'employee', 'Vic Viewer');
const nora = await account('nora', 'employee', 'Nora Outsider');
const day = (n) => addDays(localDate(), n);
const fails = async (promise, status, re) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, err.message);
  if (re) assert.match(err.message, re);
  return true;
});
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const png = (name = 'diagram.png') => ({ name, data: PNG.toString('base64') });

const p = await pia('POST', '/api/pm/projects', { name: 'Clinic system', type: 'Client', startDate: day(0) });
await pia('PUT', `/api/pm/projects/${p.id}/members`, { members: [{ userId: juan.id, role: 'member' }, { userId: vic.id, role: 'viewer' }] }).catch(async () => {
  await pia('POST', `/api/pm/projects/${p.id}/members`, { userId: juan.id, role: 'member' });
  await pia('POST', `/api/pm/projects/${p.id}/members`, { userId: vic.id, role: 'viewer' });
});

test('pictures: images only, shown inline with safe headers, to those who can open the project', async () => {
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Wire the server room', assigneeId: juan.id });
  const x = await juan('POST', `/api/pm/tasks/${t.id}/images`, { file: png() });
  assert.equal(x.type, 'image/png');
  assert.equal(x.name, 'diagram.png');
  // Not a picture: refused, by content, whatever the name says.
  await fails(juan('POST', `/api/pm/tasks/${t.id}/images`, { file: { name: 'x.png', data: Buffer.from('<svg onload="alert(1)"/>').toString('base64') } }), 400);
  await fails(juan('POST', `/api/pm/tasks/${t.id}/images`, { file: { name: 'a.pdf', data: Buffer.from('%PDF-1.4\n').toString('base64') } }), 400, /JPEG, PNG or WebP/);
  // Viewers see, but do not add; outsiders get not found.
  await fails(vic('POST', `/api/pm/tasks/${t.id}/images`, { file: png() }), 403);
  const res = await vic.raw('GET', `/api/pm/tasks/${t.id}/images/${x.id}`);
  assert.ok(Buffer.isBuffer(res.data) && res.data.equals(PNG));
  assert.equal(res.headers['Content-Type'], 'image/png');
  assert.match(res.headers['Content-Disposition'], /^inline; filename="diagram\.png"$/);
  assert.match(res.headers['Content-Security-Policy'], /default-src 'none'; sandbox/);
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  await fails(nora.raw('GET', `/api/pm/tasks/${t.id}/images/${x.id}`), 404);
  // A picture belongs to its task: another task's address does not show it.
  const t2 = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Other task' });
  await fails(pia.raw('GET', `/api/pm/tasks/${t2.id}/images/${x.id}`), 404);
  // Adding a picture does not change the task's version: the open editor can still save.
  const full = await juan('GET', `/api/pm/tasks/${t.id}`);
  assert.equal(full.version, t.version);
  assert.deepEqual(full.images.map((y) => y.id), [x.id]);
  const saved = await juan('PUT', `/api/pm/tasks/${t.id}`, { description: `Racks:\n![Diagram](img:${x.id})`, version: full.version });
  assert.equal(saved.images, undefined, 'lists do not carry the pictures');
  assert.equal((await juan('GET', `/api/pm/tasks/${t.id}`)).images.length, 1);
});

test('a picture the description stops using is removed on save (after a grace period), and with the task', async () => {
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Label the cables', assigneeId: juan.id });
  const a = await juan('POST', `/api/pm/tasks/${t.id}/images`, { file: png('a.png') });
  const b = await juan('POST', `/api/pm/tasks/${t.id}/images`, { file: png('b.png') });
  const v1 = (await juan('PUT', `/api/pm/tasks/${t.id}`, { description: `![a](img:${a.id})`, version: t.version })).version;
  // b is new: kept for now, as someone may still be writing.
  assert.equal(db.data.pmTasks.find((x) => x.id === t.id).images.length, 2);
  // Hours later, the next save that drops it removes it, and its file.
  db.data.pmTasks.find((x) => x.id === t.id).images.forEach((x) => (x.uploadedAt = new Date(Date.now() - 3 * 3600 * 1000).toISOString()));
  await juan('PUT', `/api/pm/tasks/${t.id}`, { description: `Now only a: ![a](img:${a.id})`, version: v1 });
  const left = db.data.pmTasks.find((x) => x.id === t.id).images;
  assert.deepEqual(left.map((x) => x.id), [a.id]);
  assert.ok(!fs.existsSync(path.join(dir, 'attachments', b.id)));
  assert.ok(fs.existsSync(path.join(dir, 'attachments', a.id)));
  assert.equal((fs.statSync(path.join(dir, 'attachments', a.id)).mode & 0o777).toString(8), '600');
  // Deleting the task removes its pictures.
  await pia('DELETE', `/api/pm/tasks/${t.id}`);
  assert.ok(!fs.existsSync(path.join(dir, 'attachments', a.id)));
});

test('no limit on how many pictures a task has', async () => {
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Photo survey' });
  for (let i = 0; i < 25; i++) await pia('POST', `/api/pm/tasks/${t.id}/images`, { file: png(`${i}.png`) });
  assert.equal((await pia('GET', `/api/pm/tasks/${t.id}`)).images.length, 25);
});

test('copying a project copies the pictures its descriptions use, under new ids', async () => {
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Floor plan' });
  const x = await pia('POST', `/api/pm/tasks/${t.id}/images`, { file: png('plan.png') });
  await pia('PUT', `/api/pm/tasks/${t.id}`, { description: `See ![Plan](img:${x.id})`, version: t.version });
  const copy = await pia('POST', `/api/pm/projects/${p.id}/copy`, { name: 'Clinic system B', startDate: day(10) });
  const ct = db.data.pmTasks.find((y) => y.projectId === copy.id && y.title === 'Floor plan');
  assert.equal(ct.images.length, 1);
  assert.notEqual(ct.images[0].id, x.id);
  assert.equal(ct.description, `See ![Plan](img:${ct.images[0].id})`);
  const res = await pia.raw('GET', `/api/pm/tasks/${ct.id}/images/${ct.images[0].id}`);
  assert.ok(res.data.equals(PNG));
  // Deleting the copy leaves the original's picture.
  await pia('DELETE', `/api/pm/projects/${copy.id}`);
  assert.ok(fs.existsSync(path.join(dir, 'attachments', x.id)));
  assert.ok(!fs.existsSync(path.join(dir, 'attachments', ct.images[0].id)));
});

test('descriptions keep their length limit', async () => {
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Long' });
  const r = await pia('PUT', `/api/pm/tasks/${t.id}`, { description: 'x'.repeat(RICH_MAX + 50), version: t.version }).catch((e) => e);
  assert.ok(r.status === 400 || (typeof r.description === 'string' && r.description.length <= RICH_MAX));
});

// ===== 0.24.2: layout fixes =====
test('lists: nested lists stay nested, an empty line does not split a list, checklists and numbers from 0', () => {
  assert.equal(renderRich('- a\n  - a1\n  - a2\n- b'), '<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>');
  assert.equal(renderRich('1. one\n   - sub\n2. two'), '<ol><li>one<ul><li>sub</li></ul></li><li>two</li></ol>');
  assert.equal(renderRich('- a\n\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(renderRich('1. a\n\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(renderRich('- a\n\n\n- b'), '<ul><li>a</li></ul>\n<ul><li>b</li></ul>', 'two empty lines end it');
  assert.equal(renderRich('0. zero\n1. one'), '<ol start="0"><li>zero</li><li>one</li></ol>');
  assert.match(renderRich('- [ ] todo\n- [x] done'), /<ul class="rich-tasks"><li class="rich-task"><input type="checkbox" disabled aria-label="Not done" \/> todo<\/li><li class="rich-task done"><input type="checkbox" disabled checked aria-label="Done" \/> done<\/li><\/ul>/);
  assert.equal(renderRich('- a\nNot in the list'), '<ul><li>a</li></ul>\n<p>Not in the list</p>');
});

test('inline: bold around italic, bold-italic, links with brackets, a picture inside a sentence; tables', () => {
  assert.equal(renderRich('**bold *inner* bold** and ***both***'), '<p><strong>bold <em>inner</em> bold</strong> and <strong><em>both</em></strong></p>');
  assert.match(renderRich('[wiki](https://en.wikipedia.org/wiki/Foo_(bar))'), /href="https:\/\/en\.wikipedia\.org\/wiki\/Foo_\(bar\)"/);
  assert.match(renderRich('see https://x.example/a_(b).'), /href="https:\/\/x\.example\/a_\(b\)"[^>]*>https:\/\/x\.example\/a_\(b\)<\/a>\.<\/p>/);
  const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
  assert.match(renderRich(`Before ![icon](img:${id}) after`, { image: () => '/p' }), /<p>Before <img class="rich-inline-img" src="\/p" alt="icon" loading="lazy" \/> after<\/p>/);
  assert.equal(renderRich('| a | b |\n|---|---|\n| 1 | **2** |'), '<div class="rich-table"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><strong>2</strong></td></tr></tbody></table></div>');
  assert.equal(renderRich('> a\n>\n> b'), '<blockquote><p>a</p><p>b</p></blockquote>');
  // Still no HTML through any of the new paths.
  for (const a of ['| <b onclick=x> | b |\n|---|---|\n| 1 | 2 |', '- [ ] <script>x</script>', '- a\n  - <img src=x onerror=1>', '[x](https://ok.example/(a"onmouseover="b))']) {
    assert.doesNotMatch(renderRich(a), /<(script|b |img src=x)|\son\w+="/i, a);
  }
});


// ===== 0.27: the visual editor's model -> Markdown =====
const T = (text, m = {}) => ({ text, ...m });
test('the editor\'s document becomes the same Markdown the page shows', () => {
  const md = modelToMarkdown([
    { t: 'h', level: 1, c: [T('Plan')] },
    { t: 'p', c: [T('Hello '), T('bold ', { b: true }), T('and italic', { i: true }), T(' 2*3 # x '), T('code', { code: true }), { br: true }, T('- not a list')] },
    { t: 'list', ordered: true, start: 1, items: [{ c: [T('one')], sub: [{ t: 'list', ordered: false, items: [{ c: [T('sub')] }] }] }, { c: [T('two')] }] },
    { t: 'list', ordered: false, task: true, items: [{ c: [T('todo')], checked: false }, { c: [T('done')], checked: true }] },
    { t: 'quote', paras: [[T('q1')], [T('q2')]] },
    { t: 'code', text: 'a *b*\n```\n# c' },
    { t: 'hr' },
    { t: 'p', c: [T('see '), T('the docs', { href: 'https://d.example', b: true }), T(' and '), T('bad', { href: 'javascript:alert(1)' })] },
    { t: 'table', head: [[T('a|b')], [T('c')]], rows: [[[T('1')], [T('2')]]] },
    { t: 'img', id: '0f0e0d0c-0b0a-4908-8706-050403020100', alt: 'Plan [v2]' },
  ]);
  const out = renderRich(md, { image: () => '/p' });
  assert.match(out, /<h3>Plan<\/h3>/);
  assert.match(out, /<p>Hello <strong>bold<\/strong> <em>and italic<\/em> 2\*3 # x <code>code<\/code><br \/>- not a list<\/p>/, 'typed marks stay text');
  assert.match(out, /<ol><li>one<ul><li>sub<\/li><\/ul><\/li><li>two<\/li><\/ol>/);
  assert.match(out, /<li class="rich-task done"><input type="checkbox" disabled checked aria-label="Done" \/> done<\/li>/);
  assert.match(out, /<blockquote><p>q1<\/p><p>q2<\/p><\/blockquote>/);
  assert.match(out, /<pre><code>a \*b\*\n``\u200d`\n# c<\/code><\/pre>\n<hr \/>/, 'three backticks inside code do not end it');
  assert.match(out, /see <a href="https:\/\/d\.example"[^>]*><strong>the docs<\/strong><\/a> and bad<\/p>/, 'an unsafe link becomes text');
  assert.match(out, /<th>a\|b<\/th><th>c<\/th>/, 'a | inside a cell stays in the cell');
  assert.match(out, /<figure class="rich-img"><a href="\/p"[^>]*><img src="\/p" alt="Plan  v2"/);
});

test('inline details: spaces outside marks, neighbours merged, italic next to a letter kept apart, escapes', () => {
  assert.equal(inlineToMarkdown([T('a '), T(' b ', { b: true }), T('c')]), 'a  **b** c');
  assert.equal(inlineToMarkdown([T('He', { b: true }), T('llo', { b: true })]), '**Hello**');
  const md = inlineToMarkdown([T('and '), T('italic', { i: true }), T('bad')]);
  assert.match(renderRich(md), /<em>italic<\/em>\u200bbad/);
  assert.equal(escapeMd('a*b_c~d`e[f]g|h\\i'), 'a\\*b\\_c\\~d\\`e\\[f\\]g\\|h\\\\i');
  // A typed backslash before a mark stays as typed.
  assert.match(renderRich(modelToMarkdown([{ t: 'p', c: [T('C:\\temp\\*.log')] }])), /<p>C:\\temp\\\*\.log<\/p>/);
  // Lines that would start a block stay text.
  for (const line of ['# not a heading', '> not a quote', '- not a list', '1. not a list', '```', '---']) {
    const html = renderRich(modelToMarkdown([{ t: 'p', c: [T(line)] }]));
    assert.match(html, /^<p>/, line);
  }
});

test('Markdown escapes and link words: \\* is a star, \\| inside a table cell, formatting inside a link', () => {
  assert.equal(renderRich('2 \\* 3 and \\# x'), '<p>2 * 3 and # x</p>');
  assert.match(renderRich('[**bold** `code` 2\\*3](https://x.example)'), /<a href="https:\/\/x\.example"[^>]*><strong>bold<\/strong> <code>code<\/code> 2\*3<\/a>/);
  assert.match(renderRich('| a \\| b | c |\n|---|---|\n| 1 | 2 |'), /<th>a \| b<\/th><th>c<\/th>/);
  // Old descriptions without escapes read as they did.
  assert.equal(renderRich('snake_case and 2*3*4 stay as they are'), '<p>snake_case and 2*3*4 stay as they are</p>');
});
