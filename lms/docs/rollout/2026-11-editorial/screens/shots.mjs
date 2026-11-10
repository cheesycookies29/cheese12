// Screens for the editorial email art: a demo school on a throw-away server, 2x.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
// Run from lms/:  node docs/rollout/2026-11-editorial/screens/shots.mjs <a temporary folder> <where to put the PNGs>
const [SP, OUT] = process.argv.slice(2);
const dir = `${SP}/data`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const srv = spawn('node', ['server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: '3198', DB_FILE: `${dir}/db.json`, RATE_LIMITS: 'off' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const B = 'http://localhost:3198';
let cookie = '';
const call = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie?.() || [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');
  return r.json().catch(() => ({}));
};
await call('POST', '/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'password123', schoolName: 'Lancaster Academy', campusName: 'Main Campus' });
console.log('demo:', JSON.stringify(await call('POST', '/api/admin/demo')).slice(0, 120));
const b = await chromium.launch();
const shots = [
  ['desk-signin', null, '/', false, false],
  ['desk-home', 'teacher.demo', '/', false, false],
  ['desk-learn', 'student.demo', '/lms/#/', false, false],
  ['desk-academic', 'registrar.demo', '/academic/#/', false, false],
  ['desk-payroll', 'payroll.demo', '/hris/#/payroll', false, false],
  ['desk-finance-dark', 'accountant.demo', '/finance/#/', true, false],
  ['desk-calendar', 'student.demo', '/lms/#/calendar?v=month', false, false],
  ['phone-signin', null, '/', false, true],
  ['phone-calendar', 'parent.demo', '/lms/#/calendar?v=month', false, true],
  ['phone-myday-dark', 'teacher.demo', '/hris/#/', true, true],
];
for (const [name, user, url, dark, phone] of shots) {
  const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' } : { viewport: { width: 1360, height: 850 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' });
  const p = await ctx.newPage();
  await p.goto(`${B}/`);
  if (user) { await p.fill('input[name=username]', user); await p.fill('input[name=password]', 'demo1234'); await p.click('button[type=submit]'); await p.waitForTimeout(900); }
  if (dark) await p.evaluate(() => { try { localStorage.setItem('ltdc-theme', 'dark'); localStorage.setItem('theme', 'dark'); } catch {} });
  await p.goto(`${B}${url}`); await p.waitForTimeout(1500);
  if (dark) await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log('✓', name);
  await ctx.close();
}
await b.close(); srv.kill();
