// Screens for the November 2026 rollout panels (demo school, 2x).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [B, OUT] = process.argv.slice(2);
const b = await chromium.launch();
const shots = [
  ['desk-calendar', 'student.demo', 'demo1234', '/lms/#/calendar?v=month', false, false],
  ['desk-finance-dark', 'accountant.demo', 'demo1234', '/finance/#/', true, false],
  ['desk-config', 'admin', 'password123', '/admin#/config?module=people', false, false],
  ['desk-payroll-finance', 'payroll.demo', 'demo1234', '/hris/#/payroll', false, false],
  ['phone-calendar', 'parent.demo', 'demo1234', '/lms/#/calendar?v=month', false, true],
  ['phone-myday-dark', 'teacher.demo', 'demo1234', '/hris/#/', true, true],
  ['phone-help', 'student.demo', 'demo1234', '/help/#/student', false, true],
];
for (const [name, user, pw, url, dark, phone] of shots) {
  const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' } : { viewport: { width: 1360, height: 850 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' });
  const p = await ctx.newPage();
  await p.goto(`${B}/`); await p.fill('input[name=username]', user); await p.fill('input[name=password]', pw); await p.click('button[type=submit]'); await p.waitForTimeout(900);
  if (dark) await p.evaluate(() => { try { localStorage.setItem('ltdc-theme', 'dark'); localStorage.setItem('theme', 'dark'); } catch {} });
  await p.goto(`${B}${url}`); await p.waitForTimeout(1500);
  if (dark) await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log('✓', name);
  await ctx.close();
}
await b.close();
