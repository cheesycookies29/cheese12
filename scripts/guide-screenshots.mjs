// Retakes the screenshots of the Help & guides pages (docs/guides/screenshots.json) from the demo
// data, so the guides show the screens as they are now. Run after a change to a screen:
//   npm run guides:screenshots                    (all of them)
//   npm run guides:screenshots -- hr-dtr.jpg       (only some)
// Starts a throw-away CORE server with the demo data on a free port, and needs Playwright
// (npm i -D playwright, or a Playwright that is already installed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = process.argv.find((a) => a.startsWith('--manifest='))?.slice(11) || path.join(ROOT, 'docs', 'guides', 'screenshots.json');
const OUT = path.join(ROOT, 'public', 'help', 'img');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const base = process.argv.find((a) => a.startsWith('--base='))?.slice(7); // use a running server instead
const ADMIN = { name: 'Ada Admin', username: 'admin', password: 'Guide-Shots-2026' };

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('Playwright is needed: npm i -D playwright (then npx playwright install chromium).');
  process.exit(1);
}

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

async function startServer() {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-shots-'));
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DB_FILE: path.join(dir, 'db.json'), RATE_LIMITS: 'off' }, stdio: 'ignore' });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${url}/api/auth/status`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  // The first administrator, then the demo data (with its demo accounts).
  let cookie = '';
  const call = async (method, p, body) => {
    const r = await fetch(url + p, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');
    if (!r.ok) throw new Error(`${p}: ${await r.text()}`);
    return r.json();
  };
  await call('POST', '/api/auth/setup', ADMIN);
  await call('PUT', '/api/settings', { companyName: 'Lancaster Technology and Development Corporation' });
  await call('POST', '/api/admin/demo');
  // CUSTOM APP is released dark (off until turned on, 0.71); its guide shows it on, with the demo event.
  await call('PUT', '/api/admin/modules', { modules: { customapp: true } });
  // The server saves its last minute on the way out (data/monitor.json): remove the folder after it exits.
  return { url, stop: () => new Promise((resolve) => { child.once('exit', resolve); child.kill(); }).then(() => fs.rmSync(dir, { recursive: true, force: true })) };
}

// Placeholders in a shot's url and api steps, for records whose ids are made while the shots run
// (Documents, 0.67): {doc:Title} a document this user can open, {folder:Name} a folder, {person:Name}
// an account, {saved:name.field} a field of an api step's answer kept with "save", {link:name} the
// path of a link outside the company that such a step made (shown only once, so kept here).
const saved = new Map();
async function resolve(page, value) {
  if (Array.isArray(value)) return Promise.all(value.map((v) => resolve(page, v)));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await resolve(page, v)])));
  if (typeof value !== 'string' || !value.includes('{')) return value;
  let out = value;
  for (const m of value.matchAll(/\{(doc|folder|person|saved|link):([^}]+)\}/g)) {
    const [whole, kind, key] = m;
    let id = null;
    if (kind === 'saved') id = key.split('.').slice(1).reduce((o, f) => o?.[f], saved.get(key.split('.')[0]));
    else if (kind === 'link') id = saved.get(key)?.url ? new URL(saved.get(key).url).pathname : null;
    else id = await page.evaluate(async ([k, name]) => {
      const get = (p) => fetch(p).then((r) => r.json());
      if (k === 'doc') return (await get(`/api/docs/list?view=search&q=${encodeURIComponent(name)}`)).documents.find((d) => d.title === name)?.id || null;
      if (k === 'folder') return (await get('/api/docs/folders')).folders.find((f) => f.name === name)?.id || null;
      return (await get('/api/docs/meta')).people.find((p) => p.name === name)?.id || null;
    }, [kind, key]);
    if (id == null) throw new Error(`${whole} was not found`);
    out = out.replace(whole, id);
  }
  return out;
}

const shots = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).filter((s) => !only.length || only.includes(s.file));
if (!shots.length) {
  console.error(only.length ? `None of ${only.join(', ')} is in screenshots.json.` : 'screenshots.json is empty.');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
// A shot marked "fresh" starts a new group: a new server with fresh demo data, so one guide's
// changes (payroll runs, approvals) do not change another guide's screenshots.
let server = base ? { url: base, async stop() {} } : await startServer();
const browser = await chromium.launch();
const failed = [];
try {
  for (const [i, s] of shots.entries()) {
    if (s.fresh && i > 0 && !base) {
      await server.stop();
      server = await startServer();
    }
    const phone = s.viewport === 'phone';
    const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    if (s.dark) await context.addInitScript(() => localStorage.setItem('core-theme', 'dark'));
    else await context.addInitScript(() => localStorage.setItem('core-theme', 'light'));
    const page = await context.newPage();
    const wait = s.wait ?? 800;
    try {
      await page.goto(`${server.url}/`);
      await page.fill('input[name=username]', s.user);
      await page.fill('input[name=password]', s.password || (s.user === 'admin' ? ADMIN.password : 'demo1234'));
      await page.click('button[type=submit]');
      await page.waitForTimeout(900);
      // "api": [[method, path, body], …]: changes made as that user first (e.g. so a list has entries).
      // A fourth item names the answer, to be used later as {saved:name.field} or {link:name}.
      for (const step of s.api || []) {
        const [method, p, body] = await resolve(page, step.slice(0, 3));
        const r = await page.evaluate(async ([m, url, b]) => {
          const res = await fetch(url, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
          return { ok: res.ok, text: await res.text() };
        }, [method, p, body]);
        if (!r.ok) throw new Error(`${method} ${p}: ${r.text}`);
        if (step[3]) saved.set(step[3], JSON.parse(r.text));
      }
      await page.goto(`${server.url}${await resolve(page, s.url)}`);
      await page.waitForTimeout(wait);
      for (const sel of s.click || []) {
        await page.click(sel, { timeout: 8000 });
        await page.waitForTimeout(wait);
      }
      // "files": { selector: "path from the repo" }: a file chosen in a file box (e.g. a sample photo).
      for (const [sel, file] of Object.entries(s.files || {})) {
        // One file, or several at once (a list).
        await page.setInputFiles(sel, Array.isArray(file) ? file.map((f) => path.join(ROOT, f)) : path.join(ROOT, file));
        await page.waitForTimeout(wait);
      }
      // "select": { selector: "value" }: an option picked in a list (e.g. an example to start from).
      for (const [sel, value] of Object.entries(s.select || {})) {
        await page.selectOption(sel, value);
        await page.waitForTimeout(250);
      }
      // "fill": { selector: "text" }: typed into a field (e.g. a form's title, so it is not empty).
      for (const [sel, value] of Object.entries(s.fill || {})) {
        await page.fill(sel, value);
        await page.waitForTimeout(150);
      }
      // "after": selectors clicked once the files, picks and typing are done (e.g. a dialog's Upload).
      for (const sel of s.after || []) {
        await page.click(sel, { timeout: 8000 });
        await page.waitForTimeout(wait);
      }
      if (s.scroll) await page.locator(s.scroll).first().scrollIntoViewIfNeeded();
      // "drag": selector: files from the computer held over it, not yet dropped (e.g. a task's Files card).
      if (s.drag) {
        await page.locator(s.drag).first().scrollIntoViewIfNeeded();
        const dt = await page.evaluateHandle(() => {
          const d = new DataTransfer();
          d.items.add(new File(['%PDF-1.4'], 'Signed acceptance.pdf', { type: 'application/pdf' }));
          return d;
        });
        await page.dispatchEvent('main', 'dragenter', { dataTransfer: dt });
        await page.dispatchEvent(s.drag, 'dragenter', { dataTransfer: dt });
        await page.waitForTimeout(200);
      }
      const text = await page.$eval('#app', (e) => e.innerText).catch(() => '');
      if (/Something went wrong|Not found\.|It may have been deleted|does not have access/.test(text)) throw new Error(text.slice(0, 160));
      await page.screenshot({ path: path.join(OUT, s.file), type: 'jpeg', quality: 72, fullPage: Boolean(s.full) });
      console.log('✓', s.file);
    } catch (err) {
      failed.push(`${s.file}: ${err.message.split('\n')[0]}`);
      console.log('✗', s.file, err.message.split('\n')[0]);
    }
    await context.close();
  }
} finally {
  await browser.close();
  await server.stop();
}
if (failed.length) {
  console.error(`\n${failed.length} screenshot(s) failed:\n${failed.join('\n')}`);
  process.exit(1);
}
