// Critical user journeys in a real browser (0.38), run before every deploy (.github/workflows/
// deploy-ec2.yml) and locally with `npm run journeys`. A throw-away CORE with the demo data; each
// journey is done through the screens, the way people do it, and its result checked:
//   1. Leave through three approval levels (supervisor, a named approver, HR) into attendance
//   2. A payroll run, created and finalized, and the employee's payslip
//   3. A service desk ticket from an employee, and one from the public support form
//   4. Feedback written in the visual editor, answered by an administrator
//   5. Every page in every role's menu at phone width: no page wider than the screen, no errors
// Needs Playwright (the CI job installs it; never part of CORE itself). Exit code 1 on a failure;
// screenshots of failures go to journeys-output/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'journeys-output');
const require = createRequire(path.join(ROOT, 'package.json'));
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
}
const ADMIN = { username: 'admin', password: 'Journeys-Check-2026' };
const DEMO_PW = 'demo1234';
const failures = [];
const passed = [];

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

// ----- A throw-away CORE with the demo data -----
const port = await freePort();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-journeys-'));
const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_FILE: path.join(dir, 'db.json'), RATE_LIMITS: 'off', OPEN_BROWSER: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
const BASE = `http://127.0.0.1:${port}`;
for (let i = 0; i < 150; i++) {
  try {
    if ((await fetch(`${BASE}/api/public/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
// The API as one account (for setting up and checking results; the journeys themselves use the screens).
function apiAs() {
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${data?.error || ''}`);
    return data;
  };
  call.login = (username, password = DEMO_PW) => call('POST', '/api/auth/login', { username, password });
  return call;
}
const admin = apiAs();
await admin('POST', '/api/auth/setup', { name: 'Ada Admin', ...ADMIN });
await admin('POST', '/api/admin/demo');
const users = await admin('GET', '/api/users');
const idOf = (u) => users.find((x) => x.username === u).id;
// Three approval levels: the immediate supervisor, a named approver (the payroll officer), then HR.
await admin('PUT', '/api/approval-flow', { flow: 'sequential', levels: [{ type: 'supervisor' }, { type: 'users', userIds: [idOf('payroll.demo')] }, { type: 'hr' }], attachmentsToApprovers: false });
await admin('PUT', '/api/helpdesk/settings/public-form', { enabled: true, title: 'Contact our service desk', intro: 'Tell us what happened.', defaultPriority: 'normal', categories: ['Customer complaint', 'Other'], requirePhone: false, allowFiles: false });

// ----- The browser -----
const browser = await chromium.launch();
const DESK = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
// One signed-in page per account; errors on it are collected.
async function signIn(username, password = DEMO_PW, opts = DESK) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(`console: ${m.text()}`);
  });
  await page.goto(`${BASE}/`);
  await page.fill('input[name=username]', username);
  await page.fill('input[name=password]', password);
  await page.press('input[name=password]', 'Enter');
  await page.waitForSelector('#user-btn', { state: 'attached', timeout: 15000 });
  await page.waitForTimeout(400);
  return page;
}
const go = async (page, hash) => {
  const url = `${BASE}/#${hash}`;
  // The same address again: reload, so the page shows what changed meanwhile.
  if (page.url() === url) await page.reload();
  else await page.goto(url);
  await page.waitForTimeout(600);
};
// The toast after an action: an error toast fails the journey.
async function noErrorToast(page, what) {
  const cls = await page.locator('#toast').getAttribute('class').catch(() => '');
  if (/\berror\b/.test(cls || '')) throw new Error(`${what}: ${await page.locator('#toast').textContent()}`);
}
async function submitModal(page, what) {
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(700);
  const err = await page.$eval('.modal .form-error:not([hidden])', (e) => e.textContent).catch(() => null);
  if (err && err.trim()) throw new Error(`${what}: ${err.trim()}`);
  await noErrorToast(page, what);
}
async function journey(name, fn) {
  const pages = [];
  const t0 = Date.now();
  try {
    await fn(pages);
    const errs = pages.flatMap((p) => p.errors || []);
    if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
    passed.push(`${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    fs.mkdirSync(OUT, { recursive: true });
    const shots = [];
    for (const [i, p] of pages.entries()) {
      const file = path.join(OUT, `${name.replace(/\W+/g, '-').toLowerCase()}-${i + 1}.png`);
      await p.screenshot({ path: file, fullPage: true }).catch(() => {});
      shots.push(path.relative(ROOT, file));
    }
    failures.push(`${name}: ${err.message}${shots.length ? ` (screenshots: ${shots.join(', ')})` : ''}`);
  } finally {
    for (const p of pages) await p.context().close().catch(() => {});
  }
}
// A working day about two weeks ahead (the demo company works Monday to Friday).
const day = (() => {
  const d = new Date(Date.now() + 14 * 86400000);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

// 1. Leave through three approval levels
await journey('Leave through three approval levels', async (pages) => {
  const emp = await signIn('employee.demo');
  pages.push(emp);
  await go(emp, '/me/requests');
  await emp.click('#new-request');
  await emp.waitForSelector('.modal select[name=what]');
  const leave = await emp.locator('.modal select[name=what] option[value^="leave:"]').first().getAttribute('value');
  await emp.selectOption('.modal select[name=what]', leave);
  await emp.fill('.modal input[name=startDate]', day);
  await emp.fill('.modal input[name=endDate]', day);
  await emp.fill('.modal textarea[name=reason]', 'Journeys check: family errand');
  await submitModal(emp, 'Filing the request');
  const juan = apiAs();
  await juan.login('employee.demo');
  const req = (await juan('GET', '/api/me/requests')).find((r) => r.reason === 'Journeys check: family errand');
  if (!req) throw new Error('The filed request is not in My requests.');
  if (req.approvals?.length !== 3) throw new Error(`Expected 3 approval levels, got ${req.approvals?.length}.`);
  // Each level approves on the Approval Center, in turn.
  for (const [who, pw] of [['hr.demo', DEMO_PW], ['payroll.demo', DEMO_PW], [ADMIN.username, ADMIN.password]]) {
    const p = await signIn(who, pw);
    pages.push(p);
    await go(p, '/approvals');
    const btn = p.locator(`[data-act=approve][data-id="${req.id}"]`);
    if (!(await btn.count())) throw new Error(`${who} does not see the request to approve.`);
    await btn.first().click();
    await submitModal(p, `${who} approving`);
  }
  const done = (await juan('GET', '/api/me/requests')).find((r) => r.id === req.id);
  if (done.status !== 'approved') throw new Error(`After three approvals the request is "${done.status}".`);
});

// 2. A payroll run, finalized, and the payslip
await journey('Payroll run and payslip', async (pages) => {
  const p = await signIn('payroll.demo');
  pages.push(p);
  await go(p, '/payroll');
  await p.click('#new-run');
  await p.waitForSelector('.modal input[name=periodStart]');
  await p.fill('.modal input[name=periodStart]', '2026-09-01');
  await p.fill('.modal input[name=periodEnd]', '2026-09-15');
  await p.fill('.modal input[name=payDate]', '2026-09-15');
  await submitModal(p, 'Creating the payroll run');
  await p.waitForSelector('#finalize', { timeout: 10000 });
  await p.click('#finalize');
  await submitModal(p, 'Finalizing the run');
  const officer = apiAs();
  await officer.login('payroll.demo');
  const run = (await officer('GET', '/api/payroll-runs')).find((r) => r.periodStart === '2026-09-01');
  if (!run || run.status !== 'finalized') throw new Error(`The run is ${run ? run.status : 'missing'}.`);
  const emp = await signIn('employee.demo');
  pages.push(emp);
  await go(emp, '/me/payslips');
  if (!(await emp.locator('main').textContent()).match(/Sep(tember)?\s+15|2026-09-15/)) throw new Error('The payslip for 15 September is not on My payslips.');
});

// 3. Service desk: an employee's ticket and the public form
await journey('Service desk ticket and public form', async (pages) => {
  const emp = await signIn('employee.demo');
  pages.push(emp);
  await go(emp, '/helpdesk/mine');
  await emp.click('#new-ticket');
  await emp.fill('.modal input[name=subject]', 'Journeys check: printer offline');
  await emp.fill('.modal textarea[name=body]', 'The 3F printer shows offline since this morning.');
  await submitModal(emp, 'Submitting a ticket');
  const pub = await (await browser.newContext(DESK)).newPage();
  pub.errors = [];
  pub.on('pageerror', (e) => pub.errors.push(`page error: ${e.message}`));
  pages.push(pub);
  await pub.goto(`${BASE}/support`);
  await pub.waitForSelector('#sp-form');
  await pub.fill('#sp-form input[name=name]', 'Grace Lim');
  await pub.fill('#sp-form input[name=email]', 'grace@example.org');
  await pub.fill('#sp-form input[name=subject]', 'Journeys check: billing question');
  await pub.fill('#sp-form textarea[name=message]', 'Our invoice shows the wrong period. Please check.');
  // The form refuses what is sent faster than a person types (a guard against bots).
  await pub.waitForTimeout(3500);
  await pub.click('#sp-form button[type=submit]');
  await pub.waitForSelector('#track-url', { timeout: 10000 });
  const agent = await signIn('it.demo');
  pages.push(agent);
  await go(agent, '/helpdesk/tickets');
  const text = await agent.locator('main').textContent();
  for (const s of ['Journeys check: printer offline', 'Journeys check: billing question']) if (!text.includes(s)) throw new Error(`"${s}" is not in the agent's queue.`);
});

// 4. Feedback in the visual editor, answered
await journey('Feedback written and answered', async (pages) => {
  const emp = await signIn('employee.demo');
  pages.push(emp);
  await go(emp, '/feedback');
  await emp.click('#new-feedback');
  await emp.fill('.modal input[name=subject]', 'Journeys check: payslip wording');
  await emp.locator('.modal .wys-area').click();
  await emp.keyboard.type('The payslip says ');
  await emp.keyboard.press('Control+b');
  await emp.keyboard.type('Net pay');
  await emp.keyboard.press('Control+b');
  await emp.keyboard.type(' twice on one line.');
  await submitModal(emp, 'Sending feedback');
  const adm = await signIn(ADMIN.username, ADMIN.password);
  pages.push(adm);
  await go(adm, '/admin/feedback');
  await adm.fill('#q', 'payslip wording');
  await adm.waitForTimeout(300);
  await adm.locator('[data-open-feedback], tbody tr').first().click();
  await adm.waitForSelector('#respond');
  if (!(await adm.locator('.fb-message strong').count())) throw new Error('The feedback did not keep its bold text.');
  await adm.click('#respond');
  await adm.locator('.modal .wys-area').click();
  await adm.keyboard.type('Thanks, fixed in the next update.');
  await submitModal(adm, 'Responding');
  await go(emp, '/feedback');
  await emp.locator('[data-open-feedback]').first().click();
  await emp.waitForTimeout(400);
  if (!(await emp.locator('.modal').textContent()).includes('Thanks, fixed in the next update.')) throw new Error('The sender does not see the response.');
});

// 5. Every page in every role's menu at phone width
const ROLES = [['employee.demo'], ['hr.demo'], ['payroll.demo'], ['it.demo'], ['sales.demo'], ['pm.demo'], [ADMIN.username, ADMIN.password]];
for (const [who, pw = DEMO_PW] of ROLES) {
  await journey(`Phone pages for ${who}`, async (pages) => {
    const p = await signIn(who, pw, PHONE);
    pages.push(p);
    // Every module the account opens (from CORE home), then every page in each module's menu.
    await go(p, '/launcher');
    const homes = [...new Set(await p.$$eval('main a[href^="#/"]', (as) => as.map((a) => a.getAttribute('href'))))].filter((h) => !/\/(launcher|feedback|profile)$/.test(h)).slice(0, 8);
    const found = new Set(['#/launcher', '#/feedback', '#/profile']);
    for (const h of homes) {
      await p.goto(`${BASE}/${h}`);
      await p.waitForTimeout(400);
      for (const a of await p.$$eval('#nav a[href^="#/"]', (as) => as.map((x) => x.getAttribute('href')))) found.add(a);
    }
    const hrefs = [...found].filter((h) => !/logout|sign-out/.test(h)).slice(0, 40);
    if (!hrefs.length) throw new Error('No menu links.');
    const wide = [];
    for (const h of hrefs) {
      await p.goto(`${BASE}/${h}`);
      await p.waitForTimeout(500);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) wide.push(`${h} (${over}px wider)`);
      await noErrorToast(p, h);
    }
    if (wide.length) throw new Error(`Wider than a 390px phone: ${wide.join(', ')}`);
  });
}

await browser.close();
server.kill();
fs.rmSync(dir, { recursive: true, force: true });
for (const p of passed) console.log(`  ok  ${p}`);
for (const f of failures) console.log(`  FAILED  ${f}`);
console.log(`\n${passed.length} passed, ${failures.length} failed.`);
process.exit(failures.length ? 1 : 0);
