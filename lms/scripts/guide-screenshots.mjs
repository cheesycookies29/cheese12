// Retakes the screenshots of the Help & guides pages (docs/guides/screenshots.json) from the demo
// school, so the guides show the screens as they are now. Run after a change to a screen:
//   npm run guides:screenshots                     (all of them)
//   npm run guides:screenshots -- teacher-home.jpg  (only some)
// Starts a throw-away ATLAS server with the demo school on a free port, and needs Playwright
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-shots-'));
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DB_FILE: path.join(dir, 'db.json') }, stdio: 'ignore' });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${url}/healthz`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  // The first administrator, then the demo school.
  let cookie = '';
  const call = async (method, p, body) => {
    const r = await fetch(url + p, { method, headers: { 'Content-Type': 'application/json', cookie, origin: url }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');
    if (!r.ok) throw new Error(`${p}: ${await r.text()}`);
    return r.json();
  };
  await call('POST', '/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'password123', schoolName: 'Lancaster Academy', campusName: 'Main Campus' });
  await call('POST', '/api/admin/demo');
  return { url, stop: () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const shots = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).filter((s) => !only.length || only.includes(s.file));
if (!shots.length) {
  console.error(only.length ? `None of ${only.join(', ')} is in screenshots.json.` : 'screenshots.json is empty.');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const server = base ? { url: base, stop() {} } : await startServer();
const browser = await chromium.launch();
const failed = [];
try {
  for (const s of shots) {
    const phone = s.viewport === 'phone';
    const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const wait = s.wait ?? 800;
    try {
      await page.goto(`${server.url}/`);
      await page.fill('input[name=username]', s.user);
      await page.fill('input[name=password]', s.password || (s.user === 'admin' ? 'password123' : 'demo1234'));
      await page.click('button[type=submit]');
      await page.waitForTimeout(700);
      // "api": [[method, path, body], …]: changes made as that user first (e.g. so a history has entries).
      if (s.api) {
        const bad = await page.evaluate(async (steps) => {
          for (const [method, p, body] of steps) {
            const r = await fetch(p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
            if (!r.ok) return `${method} ${p}: ${await r.text()}`;
          }
          return '';
        }, s.api);
        if (bad) throw new Error(bad);
      }
      await page.goto(`${server.url}${s.url}`);
      await page.waitForTimeout(wait);
      for (const sel of s.click || []) {
        await page.click(sel, { timeout: 8000 });
        await page.waitForTimeout(wait);
      }
      if (s.scroll) await page.locator(s.scroll).first().scrollIntoViewIfNeeded();
      const text = await page.$eval('#app', (e) => e.innerText).catch(() => '');
      if (/Something went wrong/.test(text)) throw new Error(text.slice(0, 160));
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
  server.stop();
}
if (failed.length) {
  console.error(`\n${failed.length} screenshot(s) failed:\n${failed.join('\n')}`);
  process.exit(1);
}
