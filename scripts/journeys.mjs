// Critical user journeys in a real browser (0.38), run before every deploy (.github/workflows/
// deploy-ec2.yml) and locally with `npm run journeys`. A throw-away CORE with the demo data; each
// journey is done through the screens, the way people do it, and its result checked:
//   1. Leave through three approval levels (supervisor, a named approver, HR) into attendance
//   2. A payroll run, created and finalized, and the employee's payslip
//   3. A service desk ticket from an employee, and one from the public support form
//   4. Feedback written in the visual editor, answered by an administrator
//   5. Every page in every role's menu at phone width: no page wider than the screen, no errors
//   CUSTOM APP (0.72): the guest page in each state, the presence key, the event night on four
//   devices, the seating sheet, the room plan, and the import check blocking self check-in;
//   (0.73) groups, walk-ins and substitutes, email cut, and Event control
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
// CUSTOM APP (0.71) starts off; on here, so its pages (with the demo event) are checked too.
await admin('PUT', '/api/admin/modules', { modules: { customapp: true } });
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
  // JOURNEYS_ONLY=<pattern> runs only the journeys whose name matches (while working on one).
  if (process.env.JOURNEYS_ONLY && !new RegExp(process.env.JOURNEYS_ONLY, 'i').test(name)) return;
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
// A work day two weeks ahead: not a weekend, and not a holiday on the company's calendar (the form
// refuses a range with no work days in it; 8 December, for one, is a holiday).
const day = await (async () => {
  const d = new Date(Date.now() + 14 * 86400000);
  const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const holidays = new Set();
  for (const year of [d.getFullYear(), d.getFullYear() + 1]) {
    const list = await admin('GET', `/api/holidays?year=${year}`).catch(() => []);
    for (const h of Array.isArray(list) ? list : list?.holidays || []) if (h?.date) holidays.add(h.date);
  }
  while ([0, 6].includes(d.getDay()) || holidays.has(ymd(d))) d.setDate(d.getDate() + 1);
  return ymd(d);
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
  // Each approval is waited for on the server before the next approver looks (a slow machine can
  // take longer than the form's own pause), so the next level is really theirs by then.
  const approvedLevels = async () => ((await juan('GET', '/api/me/requests')).find((r) => r.id === req.id)?.approvals || []).filter((a) => a.status === 'approved').length;
  let level = 0;
  for (const [who, pw] of [['hr.demo', DEMO_PW], ['payroll.demo', DEMO_PW], [ADMIN.username, ADMIN.password]]) {
    const p = await signIn(who, pw);
    pages.push(p);
    await go(p, '/approvals');
    const btn = p.locator(`[data-act=approve][data-id="${req.id}"]`);
    await btn.first().waitFor({ timeout: 8000 }).catch(() => {});
    if (!(await btn.count())) throw new Error(`${who} does not see the request to approve.`);
    await btn.first().click();
    await submitModal(p, `${who} approving`);
    level += 1;
    const until = Date.now() + 10000;
    while ((await approvedLevels()) < level) {
      if (Date.now() > until) throw new Error(`${who}'s approval was not recorded.`);
      await p.waitForTimeout(250);
    }
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

// 5. Pin a module to the front of the CORE home (0.40); it stays first after signing in again
await journey('Module pinned to the front', async (pages) => {
  const order = (page) => page.$$eval('#sys-track > [data-module]', (els) => els.map((e) => e.dataset.module));
  const admin = await signIn(ADMIN.username, ADMIN.password);
  pages.push(admin);
  await go(admin, '/launcher');
  const before = await order(admin);
  if (!before.includes('csuite')) throw new Error('C-suite is not on the CORE home.');
  if (!(await admin.locator('.sys-card.soon[data-module=csuite]').count())) throw new Error('C-suite is not marked Coming soon.');
  if (await admin.locator('[data-module=csuite] [data-pin]').count()) throw new Error('A module coming soon can be pinned.');
  const pinnable = await admin.$$eval('#sys-track > .sys-slot', (els) => els.map((e) => e.dataset.module));
  if (pinnable.length < 2) throw new Error('The administrator has fewer than two modules to pin.');
  const last = pinnable.at(-1);
  await admin.click(`[data-pin="${last}"]`);
  await admin.waitForTimeout(700);
  await noErrorToast(admin, 'Pinning a module');
  if ((await order(admin))[0] !== last) throw new Error(`${last} is not first after pinning it.`);
  if ((await admin.getAttribute(`[data-pin="${last}"]`, 'aria-pressed')) !== 'true') throw new Error('The star does not show the module as pinned.');
  if (!(await admin.evaluate((id) => document.activeElement?.dataset?.pin === id, last))) throw new Error('The focus left the star after pinning.');
  // Another sign-in (another device): still first.
  const again = await signIn(ADMIN.username, ADMIN.password);
  pages.push(again);
  await go(again, '/launcher');
  if ((await order(again))[0] !== last) throw new Error(`${last} is not first after signing in again.`);
  await again.click(`[data-pin="${last}"]`);
  await again.waitForTimeout(700);
  await noErrorToast(again, 'Unpinning a module');
  if ((await order(again)).join() !== before.join()) throw new Error('Unpinning did not put the modules back in their order.');
});

await journey('Task link opened, files dropped on the task', async (pages) => {
  // The task's link (/t/KEY-n) after signing in, then files dropped on its Files card (0.52, 0.53).
  const pm = await signIn('pm.demo', 'demo1234');
  pages.push(pm);
  await pm.goto(`${BASE}/t/lea-8`);
  await pm.waitForSelector('#files-card.pm-dropzone', { timeout: 10000 });
  if ((await pm.textContent('.pm-task-key')).trim() !== 'LEA-8') throw new Error('The link /t/lea-8 did not open task LEA-8.');
  const before = await pm.locator('#files .pm-files li').count();
  const dt = await pm.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(['%PDF-1.4\n% acceptance\n'], 'Acceptance.pdf', { type: 'application/pdf' }));
    d.items.add(new File(['MZ program'], 'Setup.exe', { type: 'application/x-msdownload' }));
    return d;
  });
  await pm.dispatchEvent('#files-card', 'dragenter', { dataTransfer: dt });
  if (!(await pm.locator('#files-card.pm-drop-over').count())) throw new Error('The Files card does not show it takes the drop.');
  await pm.dispatchEvent('#files-card', 'drop', { dataTransfer: dt });
  await pm.waitForFunction((n) => document.querySelectorAll('#files .pm-files li').length === n + 1, before, { timeout: 8000 });
  const toastText = await pm.textContent('#toast');
  if (!/1 file added\. Not added: Setup\.exe/.test(toastText)) throw new Error(`Unexpected message after the drop: ${toastText}`);
  // Clean up: remove the file again.
  pm.once('dialog', (d) => d.accept());
  await pm.click('#files [data-del-file]');
  await pm.click('.modal footer .btn.primary, .modal footer .btn.danger').catch(() => {});
  await pm.waitForTimeout(600);
});

// ----- CUSTOM APP (0.72, Tier 1): the event night in a browser -----
// A live "Journey Gala" (a 5 x 5 room of 10, 250 chairs) next to the demo event, with three staff:
// eventlead.demo (its Super Administrator), event.demo (tables 3 to 5) and a new Maria (tables 6 to 8).
const EV_PW = 'Journeys-Staff-2026';
const evNow = Date.now();
await admin('POST', '/api/users', { name: 'Maria Reyes', username: 'maria.staff', role: 'eventstaff', password: EV_PW, mustChangePassword: false });
const lead = apiAs();
await lead.login('eventlead.demo');
const staffA = apiAs();
await staffA.login('event.demo');
const idOfUser = async (u) => (await admin('GET', '/api/users')).find((x) => x.username === u).id;
const [leadId, aId, mariaId] = [await idOfUser('eventlead.demo'), await idOfUser('event.demo'), await idOfUser('maria.staff')];
const csvRow = (r) => r.map((c) => (/[",]/.test(c) ? `"${c}"` : c)).join(',');
async function journeyEvent(name, rows, { live = true, opensInMs = -3600000, ack = true, open = true } = {}) {
  const ev = await admin('POST', '/api/customapp/events', { name, date: new Date(evNow).toISOString().slice(0, 10), superAdminUserId: leadId, industries: [{ name: 'Banking', related: ['Insurance'] }, { name: 'Insurance' }, { name: 'Retail' }, { name: 'Technology' }] });
  const base = `/api/customapp/events/${ev.id}`;
  let e = await lead('GET', base);
  e = await lead('PATCH', base, { rev: e.rev, staff: [{ userId: aId }, { userId: mariaId }], status: live ? 'live' : 'draft', window: { opensAt: new Date(evNow + opensInMs).toISOString(), closesAt: new Date(evNow + 6 * 3600000).toISOString() } });
  for (const t of e.tables) {
    const classification = t.number <= 2 ? 'preferred' : t.number === 25 ? 'employee' : 'regular';
    const ownerUserId = t.number >= 3 && t.number <= 5 ? aId : t.number >= 6 && t.number <= 8 ? mariaId : null;
    if (classification !== 'regular' || ownerUserId) await lead('POST', `${base}/commands`, { type: 'table.update', tableId: t.id, classification, ownerUserId });
  }
  if (rows.length) {
    const pv = await lead('POST', `${base}/import`, { format: 'csv', data: ['Ref,First name,Surname,Company,Industry,Email,Mobile,Classification,Personnel', ...rows.map(csvRow)].join('\n') });
    await lead('POST', `${base}/import/${pv.jobId}/apply`, {});
  }
  if (ack) await lead('POST', `${base}/commands`, { type: 'importAck' });
  if (open) await lead('POST', `${base}/commands`, { type: 'setFlag', flag: 'registrationOpen', value: true });
  const full = await lead('GET', base);
  const guests = (await lead('GET', `${base}/guests?limit=300`)).guests;
  const g = (ref) => guests.find((x) => x.externalKey === ref || x.ref === ref);
  const t = (n) => full.tables.find((x) => x.number === n);
  const cmd = (who, body) => who('POST', `${base}/commands`, body);
  return { id: ev.id, code: full.code, base, g, t, cmd };
}
const rows = [
  ['G1', 'Ana', 'Dela Cruz', 'Northbay Bank', 'Banking', 'g1@example.com', '0917 111 4417', 'regular', 'event.demo'],
  ['G2', 'Juan', 'Reyes', 'Palengke', 'Retail', 'g2@example.com', '0917 111 5501', 'regular', 'event.demo'],
  ['G3', 'Liza', 'Ocampo', 'Palengke', 'Retail', 'g3@example.com', '0917 111 5502', 'regular', 'event.demo'],
  ['G4', 'Paolo', 'Villareal', 'Bitwise', 'Technology', 'g4@example.com', '0917 111 5503', 'regular', 'event.demo'],
  ['W1', 'Wena', 'Uno', 'Palengke', 'Retail', 'w1@example.com', '0917 222 0001', 'regular', 'event.demo'],
  ['W2', 'Wally', 'Dos', 'Palengke', 'Retail', 'w2@example.com', '0917 222 0002', 'regular', 'event.demo'],
  ['W3', 'Wilma', 'Tres', 'Harbor Life', 'Insurance', 'w3@example.com', '0917 222 0003', 'regular', ''],
  ['W4', 'Wendell', 'Cuatro', 'Isla Savings', 'Banking', 'w4@example.com', '0917 222 0004', 'regular', 'maria.staff'],
  ['W5', 'Winnie', 'Cinco', 'Isla Savings', 'Banking', 'w5@example.com', '0917 222 0005', 'regular', 'maria.staff'],
  ['P1', 'Pia', 'Santos', 'Northbay Bank', 'Banking', 'p1@example.com', '0917 333 0001', 'preferred', ''],
  ...Array.from({ length: 27 }, (_, i) => [`F${i + 1}`, `Filler${i + 1}`, `Fill${String.fromCharCode(65 + (i % 26))}${i}`, 'Northbay Bank', 'Banking', `f${i + 1}@example.com`, `0917 444 ${String(1000 + i)}`, 'regular', 'event.demo']),
];
const J = await journeyEvent('Journey Gala', rows);
await J.cmd(lead, { type: 'reserve', guestId: J.g('P1').id, tableId: J.t(1).id, seatNo: 3, reason: 'Preferred' });
const guestPhone = async () => {
  const ctxt = await browser.newContext(PHONE);
  const p = await ctxt.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(`page error: ${e.message}`));
  return p;
};
const GUEST_NEVER = /not found|invalid|already checked in|\b429\b|too many|locked|countdown/i;
async function typeVerify(p, surname, last4) {
  await p.waitForSelector('#surname');
  await p.fill('#surname', surname);
  await p.fill('#last4', last4);
  await p.waitForTimeout(1600); // a person takes longer than the minimum fill time
  await p.click('#go');
  await p.waitForFunction(() => !document.querySelector('#go'), null, { timeout: 8000 });
}
const textOf = (p, sel = 'body') => p.locator(sel).first().textContent();

await journey('Event guest page: closed, verify, pending, seated, referred, offline', async (pages) => {
  // Closed: a live event whose window opens in two hours.
  const later = await journeyEvent('Later Gala', [rows[0]], { opensInMs: 2 * 3600000 });
  const closed = await guestPhone();
  pages.push(closed);
  await closed.goto(`${BASE}/event/${later.code}`);
  await closed.waitForSelector('#box h1');
  if (!/^Registration opens at \d{1,2}:\d{2}\s?[AP]M\.$/.test((await textOf(closed, '#box h1')).trim())) throw new Error(`Closed: "${await textOf(closed, '#box h1')}"`);
  if (await closed.locator('#box input').count()) throw new Error('The closed page has inputs.');
  // Verify, then pending.
  const p = await guestPhone();
  pages.push(p);
  await p.goto(`${BASE}/event/${J.code}`);
  await p.waitForSelector('#last4');
  if ((await p.getAttribute('#last4', 'inputmode')) !== 'numeric' || (await p.getAttribute('#surname', 'placeholder')) !== 'e.g. Dela Cruz') throw new Error('The verify form is not as designed.');
  await typeVerify(p, 'dela cruz', '4417');
  if (!/You're checked in, Ana\./.test(await textOf(p, '#box'))) throw new Error(`Pending: ${await textOf(p, '#box')}`);
  if (!/^#s=[A-Za-z0-9_-]{43}$/.test(new URL(p.url()).hash)) throw new Error('The token is not in the fragment.');
  if (!(await p.evaluate((c) => localStorage.getItem(`ca-ev:${c}`), J.code))) throw new Error('No localStorage copy of the token.');
  if ((await p.getAttribute('#box', 'aria-live')) !== 'polite') throw new Error('The status region is not aria-live polite.');
  // Seated by staff: the page updates by itself, announces it and moves focus to the heading.
  await J.cmd(staffA, { type: 'assign', guestId: J.g('G1').id, tableId: J.t(3).id, seatNo: 2 });
  await p.waitForSelector('#table-no', { timeout: 9000 });
  if ((await textOf(p, '#table-no')).trim() !== 'Table 3' || !/Seat 2/.test(await textOf(p, '#box'))) throw new Error(`Seated: ${await textOf(p, '#box')}`);
  if (parseFloat(await p.$eval('#table-no', (e) => getComputedStyle(e).fontSize)) < 56) throw new Error('The table number is under 56 px.');
  if (!(await p.evaluate(() => document.activeElement?.tagName === 'H1'))) throw new Error('Focus did not move to the result heading.');
  if (!/^Updated \d{1,2}:\d{2}\s?[AP]M$/.test((await textOf(p, '#updated')).trim())) throw new Error(`Status line: ${await textOf(p, '#updated')}`);
  // Reload: from the fragment; a new tab without it: from localStorage.
  await p.reload();
  await p.waitForSelector('#table-no', { timeout: 8000 });
  const tab = await p.context().newPage();
  tab.errors = [];
  pages.push(tab);
  await tab.goto(`${BASE}/event/${J.code}`);
  await tab.waitForSelector('#table-no', { timeout: 8000 });
  // Offline: the last status stays, and says it will update.
  await p.context().setOffline(true);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForFunction(() => /Will update when you reconnect/.test(document.getElementById('updated').textContent), null, { timeout: 8000 });
  if (!(await p.locator('#table-no').count())) throw new Error('Offline: the last status is gone.');
  await p.context().setOffline(false);
  // Referred: a wrong number gets a code, the same for every failure.
  const r = await guestPhone();
  pages.push(r);
  await r.goto(`${BASE}/event/${J.code}`);
  await typeVerify(r, 'Reyes', '9999');
  if (!/^Please see the registration desk and show this code: R-\d{4}$/.test((await textOf(r, '#box h1')).trim())) throw new Error(`Referred: ${await textOf(r, '#box h1')}`);
  for (const x of [closed, p, tab, r]) if (GUEST_NEVER.test(await textOf(x))) throw new Error(`The guest page said: ${(await textOf(x)).match(GUEST_NEVER)[0]}`);
});

await journey('Event guest page: the QR presence key is sent without typing', async (pages) => {
  const on = await lead('POST', `${J.base}/qr-key`, { on: true });
  try {
    const typed = await guestPhone();
    pages.push(typed);
    await typed.goto(`${BASE}/event/${J.code}`);
    await typeVerify(typed, 'Villareal', '5503');
    if (!/registration desk/.test(await textOf(typed, '#box h1'))) throw new Error('Without the key the guest should be sent to the desk.');
    const scanned = await guestPhone();
    pages.push(scanned);
    await scanned.goto(`${BASE}/event/${J.code}#k=${on.key}`);
    await scanned.waitForSelector('#surname');
    if (new URL(scanned.url()).hash) throw new Error('The key stays in the address bar.');
    await typeVerify(scanned, 'Villareal', '5503');
    if (!/You're checked in/.test(await textOf(scanned, '#box'))) throw new Error(`With the key: ${await textOf(scanned, '#box')}`);
  } finally {
    await lead('POST', `${J.base}/qr-key`, { on: false });
  }
});

await journey('Event night, four devices', async (pages) => {
  const q = (p) => `${BASE}/#/customapp/queue?e=${J.id}`;
  // Staff phone A lands on My queue.
  const a = await signIn('event.demo', DEMO_PW, PHONE);
  pages.push(a);
  if (!/#\/customapp\/queue/.test(a.url())) throw new Error(`Event staff landed on ${a.url()}`);
  await a.goto(q());
  await a.waitForSelector('[data-bar] [data-age]');
  await a.waitForFunction(() => /Last updated/.test(document.querySelector('[data-bar]').textContent), null, { timeout: 6000 });
  for (const h of ['Waiting for table', 'Checked in and seated', 'Find guest']) if (!(await textOf(a, 'main')).includes(h)) throw new Error(`My queue has no "${h}" section.`);
  // Staff phone B (Maria): nobody waiting for her yet.
  const b = await signIn('maria.staff', EV_PW, PHONE);
  pages.push(b);
  await b.goto(q());
  await b.waitForSelector('[data-waiting]');
  await b.waitForFunction(() => /No one is waiting for you/.test(document.querySelector('[data-waiting]').textContent), null, { timeout: 6000 });
  const empty = (await textOf(b, '[data-waiting]')).trim();
  if (empty !== 'No one is waiting for you. Your tables: 6, 7, 8 (30 seats left).') throw new Error(`Empty queue: "${empty}"`);
  // The guest's phone checks in: A's queue shows the card, oldest first, with its class in words and a wait timer.
  const guest = await guestPhone();
  pages.push(guest);
  await guest.goto(`${BASE}/event/${J.code}`);
  await typeVerify(guest, 'Reyes', '5501');
  const g2 = J.g('G2').id;
  await a.waitForSelector(`.ca-qcard[data-guest="${g2}"]`, { timeout: 8000 });
  const cardText = await textOf(a, `.ca-qcard[data-guest="${g2}"]`);
  for (const s of ['Juan Reyes', 'Palengke', 'Retail', 'Regular', 'Waiting']) if (!cardText.includes(s)) throw new Error(`The card lacks "${s}": ${cardText}`);
  // The wait timer turns amber at 4 minutes and red at 8.
  const colour = await a.evaluate(async () => {
    const w = document.querySelector('.ca-wait');
    const out = [];
    for (const m of [5, 9]) {
      w.dataset.since = new Date(Date.now() - m * 60000).toISOString();
      await new Promise((r) => setTimeout(r, 5500));
      out.push(w.className);
    }
    return out;
  });
  if (!/amber/.test(colour[0]) || !/red/.test(colour[1])) throw new Error(`Wait timer classes: ${colour}`);
  // A opens the sheet: up to 3 recommendations with why, other eligible tables collapsed, not yours read only.
  await a.click(`.ca-qcard[data-guest="${g2}"]`);
  await a.waitForSelector('.ca-sheet [data-recs]');
  const recs = await a.locator('.ca-sheet [data-recs] > li').count();
  if (recs < 1 || recs > 3) throw new Error(`${recs} recommendations.`);
  if (!(await a.locator('.ca-sheet [data-recs] .ca-why').first().textContent()).match(/seats? left/)) throw new Error('A recommendation has no reason line.');
  if (await a.locator('.ca-sheet [data-other-eligible][open]').count()) throw new Error('Other eligible tables are not collapsed.');
  if (!(await a.locator('.ca-sheet [data-not-yours] .ca-table:disabled').count())) throw new Error('No read-only Not yours list.');
  // A chooses a table (the sheet now waits on Confirm)…
  await a.click('.ca-sheet [data-recs] .ca-table');
  await a.waitForSelector('.ca-sheet [data-confirm]');
  // The Super Administrator's desk moves the guest to Maria.
  const desk = await signIn('eventlead.demo');
  pages.push(desk);
  await desk.goto(`${BASE}/#/customapp/find?e=${J.id}`);
  await desk.fill('#ca-q', 'Juan Reyes');
  await desk.click(`[data-guest="${g2}"]`);
  await desk.waitForSelector('.ca-sheet [data-owner]');
  await desk.selectOption('.ca-sheet [data-owner]', mariaId);
  await desk.waitForTimeout(800);
  await noErrorToast(desk, 'Moving the guest to Maria');
  // A: greyed out with who has them now, then a refused write shows a recovery screen.
  await a.waitForSelector(`[data-moved="${g2}"]`, { timeout: 8000 });
  if (!/Moved to Maria Reyes's queue by the Super Administrator, \d{1,2}:\d{2}\s?[AP]M/.test(await textOf(a, `[data-moved="${g2}"]`))) throw new Error(`Moved: ${await textOf(a, `[data-moved="${g2}"]`)}`);
  await a.click('.ca-sheet [data-confirm]');
  await a.waitForSelector('.ca-sheet .ca-notice', { timeout: 5000 });
  if (!/no longer yours/.test(await textOf(a, '.ca-sheet .ca-notice'))) throw new Error(`Recovery: ${await textOf(a, '.ca-sheet .ca-notice')}`);
  await a.keyboard.press('Escape');
  // B (Maria) now has the guest and seats them in two taps: a table, then Confirm.
  await b.waitForSelector(`.ca-qcard[data-guest="${g2}"]`, { timeout: 8000 });
  await b.click(`.ca-qcard[data-guest="${g2}"]`);
  await b.click('.ca-sheet [data-recs] .ca-table');
  const confirm = (await textOf(b, '.ca-sheet [data-confirm]')).trim();
  if (!/^Seat at Table 6/.test(confirm)) throw new Error(`Confirm reads "${confirm}"`);
  await b.click('.ca-sheet [data-confirm]');
  await b.waitForTimeout(700);
  await noErrorToast(b, 'Seating at table 6');
  await guest.waitForSelector('#table-no', { timeout: 9000 });
  if ((await textOf(guest, '#table-no')).trim() !== 'Table 6') throw new Error('The guest phone does not show table 6.');
  // The cap at the desk: 8 different wrong numbers, then even the right one is referred; one tap clears it.
  const capped = await guestPhone();
  pages.push(capped);
  await capped.goto(`${BASE}/event/${J.code}`);
  for (let i = 0; i < 8; i++) {
    await typeVerify(capped, 'Ocampo', String(6000 + i));
    await capped.click('#again');
  }
  await typeVerify(capped, 'Ocampo', '5502');
  const code = (await textOf(capped, '#box .code')).trim();
  if (!/^R-\d{4}$/.test(code)) throw new Error(`No code: ${await textOf(capped, '#box')}`);
  await desk.keyboard.press('Escape');
  await desk.goto(`${BASE}/#/customapp/find?e=${J.id}`);
  await desk.fill('#ca-q', code);
  await desk.waitForSelector(`.ca-ref [data-clear-checkin]`, { timeout: 6000 });
  const ref = await textOf(desk, '.ca-ref');
  if (!/soft cap/.test(ref) || !/“Ocampo”/.test(ref) || !/••02/.test(ref)) throw new Error(`Referral: ${ref}`);
  if (!/Clear cap and check in/.test(ref)) throw new Error('No "Clear cap and check in".');
  await desk.click('.ca-ref [data-clear-checkin]');
  await desk.waitForTimeout(800);
  await noErrorToast(desk, 'Clear cap and check in');
  const g3 = (await lead('GET', `${J.base}/guests/${J.g('G3').id}`)).guest;
  if (g3.arrival.state !== 'checked_in') throw new Error('Clear cap and check in did not check the guest in.');
  // Polling pauses while hidden; after 15 s without answers the bar says Reconnecting….
  let asks = 0;
  b.on('request', (r) => r.url().includes('/changes') && asks++);
  await b.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  asks = 0;
  await b.waitForTimeout(4500);
  if (asks) throw new Error(`${asks} polls while the tab was hidden.`);
  await b.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await b.context().setOffline(true);
  await b.waitForFunction(() => document.querySelector('[data-bar]').classList.contains('stale') && /Reconnecting…/.test(document.querySelector('[data-bar]').textContent), null, { timeout: 20000 });
  await b.context().setOffline(false);
  await b.waitForFunction(() => !document.querySelector('[data-bar]').classList.contains('stale'), null, { timeout: 40000 });
});

await journey('Event sheet: two taps, meter, last seat, phone floor (Tier 0 screens)', async (pages) => {
  // Table 3: 6 seated and 2 reserved; table 4 full; table 5 one chair left.
  const fill = (n, from, count) => Array.from({ length: count }, (_, i) => ({ guest: J.g(`F${from + i}`), table: J.t(n), seat: i + 1 }));
  const plan = [...fill(3, 1, 8), ...fill(4, 9, 10), ...fill(5, 19, 9)];
  const t3 = (await lead('GET', `${J.base}/room`)).tables.find((t) => t.number === 3);
  const taken3 = new Set(t3.chairs.filter((c) => c.taken).map((c) => c.seatNo));
  let s3 = 1;
  for (const x of plan) {
    let seat = x.seat;
    if (x.table.number === 3) {
      while (taken3.has(s3)) s3++;
      seat = s3++;
    }
    await J.cmd(lead, { type: 'reserve', guestId: x.guest.id, tableId: x.table.id, seatNo: seat });
  }
  // G1 sits at table 3 already (seated): 5 more reserved guests check in → 6 seated, 2 reserved.
  for (let i = 1; i <= 5; i++) await J.cmd(lead, { type: 'checkIn', guestId: J.g(`F${i}`).id });
  // Table 3 now holds 9 (G1 + 8): release one reservation to leave 6 seated, 2 reserved, 2 free.
  await J.cmd(lead, { type: 'release', guestId: J.g('F8').id, reason: 'Journey set-up' });
  for (const w of ['W1', 'W2']) await J.cmd(lead, { type: 'checkIn', guestId: J.g(w).id });
  const a = await signIn('event.demo', DEMO_PW, PHONE);
  pages.push(a);
  const b = await signIn('eventlead.demo', DEMO_PW, PHONE);
  pages.push(b);
  const open = async (p, ref, name) => {
    await p.goto(`${BASE}/#/customapp/find?e=${J.id}`);
    await p.fill('#ca-q', name);
    await p.click(`[data-guest="${J.g(ref).id}"]`);
    await p.waitForSelector('.ca-sheet .ca-table');
  };
  await open(a, 'W1', 'Wena Uno');
  // The meter: filled for seated, a ring for reserved, and the same in words.
  const t3btn = a.locator(`.ca-sheet .ca-table[data-table="${J.t(3).id}"]`);
  if (!/6 seated · 2 reserved · 2 free/.test(await t3btn.textContent())) throw new Error(`Table 3 meter: ${await t3btn.textContent()}`);
  if ((await t3btn.locator('.ca-meter i.on').count()) !== 6 || (await t3btn.locator('.ca-meter i.res').count()) !== 2) throw new Error('Meter dots are not 6 filled and 2 rings.');
  await a.click('.ca-sheet [data-other-eligible] summary');
  const full = a.locator(`.ca-sheet .ca-table[data-table="${J.t(4).id}"]`);
  if (!(await full.isDisabled()) || !/Full/.test(await full.textContent())) throw new Error('The full table can be chosen.');
  // Two taps: a table (its first free chair already chosen), then Confirm.
  await a.click(`.ca-sheet .ca-table[data-table="${J.t(5).id}"]`);
  if ((await a.textContent('.ca-sheet .ca-chair.on'))?.trim() !== '10') throw new Error('The first free chair is not preselected.');
  if (!(await a.locator('.ca-sheet .ca-chair:disabled').count())) throw new Error('Taken chairs are not disabled.');
  if (!/^Seat at Table 5, seat 10$/.test((await textOf(a, '.ca-sheet [data-confirm]')).trim())) throw new Error(`Confirm: ${await textOf(a, '.ca-sheet [data-confirm]')}`);
  // The other phone goes for the same last chair.
  await open(b, 'W2', 'Wally Dos');
  await b.click(`.ca-sheet .ca-table[data-table="${J.t(5).id}"]`);
  await a.click('.ca-sheet [data-confirm]');
  await a.waitForTimeout(700);
  await noErrorToast(a, 'Seating the last chair');
  await b.click('.ca-sheet [data-confirm]');
  await b.waitForSelector('.ca-sheet .ca-notice', { timeout: 5000 });
  if (!/^Table 5 just filled\. Updated options:$/.test((await textOf(b, '.ca-sheet .ca-notice')).trim())) throw new Error(`409 screen: ${await textOf(b, '.ca-sheet .ca-notice')}`);
  if ((await textOf(b, '.ca-sheet .modal-title h2')).trim() !== 'Wally Dos') throw new Error('The guest is no longer selected after the refusal.');
  // The phone floor (U6): 390 px, inputs 16 px, targets 48 px, badges and meters in words, keyboard,
  // contrast in both themes, reduced motion.
  const floor = await b.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > 391) out.push(`page ${document.documentElement.scrollWidth}px wide`);
    for (const el of document.querySelectorAll('.ca-sheet input, .ca-sheet select, #ca-q')) if (parseFloat(getComputedStyle(el).fontSize) < 16) out.push(`input font ${getComputedStyle(el).fontSize}`);
    for (const el of document.querySelectorAll('.ca-sheet .ca-big, .ca-sheet .ca-table, .ca-sheet .ca-chair')) if (el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 47.5) out.push(`${el.className} ${el.getBoundingClientRect().height}px tall`);
    for (const el of document.querySelectorAll('.ca-sheet .badge')) if (!el.textContent.trim()) out.push('an empty badge');
    for (const el of document.querySelectorAll('.ca-sheet .ca-meter')) if (!/seated · \d+ reserved · \d+ free/.test(el.parentElement.textContent)) out.push('a meter without words');
    return out;
  });
  if (floor.length) throw new Error(floor.slice(0, 4).join('; '));
  const contrast = (p) => p.evaluate(() => {
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const bgOf = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const c = rgb(getComputedStyle(e).backgroundColor);
        if (c.length && (c[3] === undefined || c[3] > 0.9)) return c;
      }
      return [255, 255, 255];
    };
    const bad = [];
    for (const el of document.querySelectorAll('.ca-sheet .ca-tno, .ca-sheet .ca-count, .ca-sheet .badge, .ca-sheet .ca-notice, .ca-sheet h3, .ca-sheet .ca-why')) {
      const c = rgb(getComputedStyle(el).color);
      if (c[3] !== undefined && c[3] < 1) continue;
      const [l1, l2] = [lum(c), lum(bgOf(el))].sort((x, y) => y - x);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      if (ratio < 4.5) bad.push(`${el.className || el.tagName} ${ratio.toFixed(2)}`);
    }
    return bad;
  });
  let low = await contrast(b);
  if (low.length) throw new Error(`Contrast (light): ${low.slice(0, 3).join(', ')}`);
  await b.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  low = await contrast(b);
  if (low.length) throw new Error(`Contrast (dark): ${low.slice(0, 3).join(', ')}`);
  await b.evaluate(() => delete document.documentElement.dataset.theme);
  // Keyboard: Find guest results open with Enter; reduced motion: the sheet does not animate.
  await b.keyboard.press('Escape');
  await b.emulateMedia({ reducedMotion: 'reduce' });
  await b.focus(`[data-guest="${J.g('W2').id}"]`);
  await b.keyboard.press('Enter');
  await b.waitForSelector('.ca-sheet');
  if ((await b.$eval('.ca-sheet', (e) => getComputedStyle(e).animationName)) !== 'none') throw new Error('The sheet animates with reduced motion on.');
});

await journey('Room model: states, legend, recommendations, keyboard and zoom, timing', async (pages) => {
  await J.cmd(lead, { type: 'checkIn', guestId: J.g('W3').id });
  const desk = await signIn('eventlead.demo');
  pages.push(desk);
  await desk.goto(`${BASE}/#/customapp/room?e=${J.id}`);
  await desk.waitForSelector('[data-plan] .ca-tbl');
  await desk.waitForTimeout(400);
  // Timing: 250 chairs drawn in under 300 ms.
  const ms = Number(await desk.getAttribute('[data-room]', 'data-render-ms'));
  if (!(ms < 300)) throw new Error(`The plan took ${ms} ms to draw.`);
  if ((await desk.locator('[data-plan] .ca-chair').count()) !== 250) throw new Error('Not 250 chairs.');
  // States by fill and shape, a legend, FULL tables, table types.
  const legend = await textOf(desk, '.ca-legend');
  for (const s of ['Open chair', 'Reserved, not arrived', 'Seated', 'Chosen chair', 'Preferred table', 'Employee table', 'Recommended']) if (!legend.includes(s)) throw new Error(`Legend lacks "${s}".`);
  if (!(await desk.locator('[data-plan] .ca-c-res[fill^="url(#ca-h-"]').count())) throw new Error('No hatched reserved chair.');
  if (!(await desk.locator('[data-plan] .ca-c-seat').count()) || !(await desk.locator('[data-plan] .ca-c-ini').count())) throw new Error('No solid seated chair with initials.');
  if (!(await desk.locator(`[data-plan] .ca-tbl.full[data-table="${J.t(4).id}"] .ca-t-count`).textContent()).includes('FULL')) throw new Error('Table 4 does not say FULL.');
  if (!(await desk.locator('[data-plan] .ca-tbl.ca-type-preferred').count()) || !(await desk.locator('[data-plan] .ca-tbl.ca-type-employee').count())) throw new Error('Table types are not drawn.');
  // A waiting guest: three ranked tables, ineligible ones dimmed.
  await desk.click(`[data-guest="${J.g('W3').id}"]`);
  await desk.waitForFunction(() => document.querySelectorAll('[data-plan] .ca-tbl.rec').length === 3, null, { timeout: 5000 });
  const ranks = await desk.$$eval('[data-plan] .ca-tbl.rec .ca-rank-t', (els) => els.map((e) => e.textContent).sort());
  if (ranks.join() !== '1,2,3') throw new Error(`Ranks: ${ranks}`);
  if (!(await desk.locator(`[data-plan] .ca-tbl.out[data-table="${J.t(1).id}"]`).count())) throw new Error('A preferred table is not dimmed for a regular guest.');
  // Zoom and pan after n8n's canvas, arrows between tables, Enter opens.
  await desk.focus('[data-plan]');
  await desk.keyboard.press('+');
  if (!(Number(await desk.getAttribute('[data-room]', 'data-scale')) > 1)) throw new Error('+ did not zoom in.');
  await desk.keyboard.press('-');
  await desk.keyboard.press('+');
  await desk.keyboard.press('1');
  if (Number(await desk.getAttribute('[data-room]', 'data-scale')) !== 1) throw new Error('1 did not fit the room.');
  await desk.click('[data-z="in"]');
  await desk.click('[data-z="fit"]');
  const box = await desk.locator('[data-plan]').boundingBox();
  await desk.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await desk.keyboard.down('Control');
  await desk.mouse.wheel(0, -300);
  await desk.keyboard.up('Control');
  if (!(Number(await desk.getAttribute('[data-room]', 'data-scale')) > 1)) throw new Error('Ctrl+scroll did not zoom.');
  await desk.focus('[data-plan]');
  await desk.keyboard.press('1');
  await desk.keyboard.press('ArrowDown');
  await desk.keyboard.press('ArrowDown');
  await desk.keyboard.press('ArrowLeft');
  await desk.keyboard.press('Enter');
  await desk.waitForSelector('.ca-dial');
  const opened = (await textOf(desk, '.ca-tview-head strong')).trim();
  if (opened !== 'Table 8') throw new Error(`Arrows then Enter opened ${opened}, not table 8 (from table 1: down twice, then one column away from the stage).`);
  if ((await desk.locator('.ca-dial .ca-dchair').count()) !== 10) throw new Error('The table does not show its ten chairs.');
});

await journey('Room model: phone, keyboard, two devices and a chair taken meanwhile', async (pages) => {
  for (const w of ['W4', 'W5']) await J.cmd(lead, { type: 'checkIn', guestId: J.g(w).id });
  const desk = await signIn('eventlead.demo');
  pages.push(desk);
  await desk.goto(`${BASE}/#/customapp/room?e=${J.id}`);
  await desk.waitForSelector('[data-plan] .ca-tbl');
  const m = await signIn('maria.staff', EV_PW, PHONE);
  pages.push(m);
  await m.goto(`${BASE}/#/customapp/room?e=${J.id}`);
  await m.waitForSelector(`[data-guest="${J.g('W4').id}"]`, { timeout: 8000 });
  // Other people's tables: dimmed and Not yours.
  if (!(await m.locator(`[data-plan] .ca-tbl.out[data-table="${J.t(3).id}"] .ca-t-lock`).count())) throw new Error('Table 3 is not marked Not yours for Maria.');
  await m.click(`[data-guest="${J.g('W4').id}"]`);
  await m.waitForSelector('[data-rec]');
  await m.click('[data-rec] >> nth=0');
  await m.waitForSelector('.ca-dial');
  const chairs = await m.$$eval('.ca-dial .ca-dchair', (els) => els.map((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height, e.getAttribute('aria-label')]));
  if (chairs.length !== 10 || chairs.some(([w, h]) => w < 47.5 || h < 47.5)) throw new Error(`Chair buttons: ${JSON.stringify(chairs.slice(0, 2))}`);
  if (!chairs.some(([, , l]) => /^Chair \d+: Juan Reyes, Palengke/.test(l))) throw new Error('A taken chair is not labelled with who sits there.');
  // Keyboard: focus an open chair, Enter, then Seat here.
  const open = await m.$eval('.ca-dial .ca-dchair:not(.seated):not(.reserved)', (e) => e.dataset.dchair);
  const tableName = (await textOf(m, '.ca-tview-head strong')).trim();
  await m.focus(`.ca-dial [data-dchair="${open}"]`);
  await m.keyboard.press('Enter');
  await m.waitForSelector('[data-act="seat"]');
  await m.focus('[data-act="seat"]');
  await m.keyboard.press('Enter');
  await m.waitForTimeout(900);
  await noErrorToast(m, 'Seating from the room plan');
  const tid = J.t(Number(tableName.replace('Table ', ''))).id;
  // The desk's plan shows it within one poll.
  await desk.waitForFunction(([t, n]) => {
    const g = document.querySelector(`[data-plan] [data-table="${t}"]`);
    return g && [...g.querySelectorAll('.ca-hit')].some((h) => h.dataset.chair === `${t}:${n}` && h.previousElementSibling?.classList.contains('ca-c-ini'));
  }, [tid, open], { timeout: 6000 });
  // A chair taken on another device while it was chosen here: the plan redraws and says so.
  await m.click(`[data-guest="${J.g('W5').id}"]`);
  await m.waitForSelector('[data-rec]');
  await m.click(`[data-rec="${tid}"]`).catch(() => m.click('[data-rec] >> nth=0'));
  const t2 = (await textOf(m, '.ca-tview-head strong')).trim();
  const tid2 = J.t(Number(t2.replace('Table ', ''))).id;
  const free = await m.$eval('.ca-dial .ca-dchair:not(.seated):not(.reserved)', (e) => e.dataset.dchair);
  await m.click(`.ca-dial [data-dchair="${free}"]`);
  await J.cmd(lead, { type: 'assign', guestId: J.g('W3').id, tableId: tid2, seatNo: Number(free) });
  await m.click('[data-act="seat"]');
  await m.waitForSelector('.ca-notice', { timeout: 5000 });
  if (!new RegExp(`Chair ${free} at table \\d+ was just taken`).test(await textOf(m, '[data-detail] .ca-notice'))) throw new Error(`409 on the plan: ${await textOf(m, '[data-detail] .ca-notice')}`);
  if (await m.evaluate(() => document.documentElement.scrollWidth) > 391) throw new Error('The room plan is wider than the phone.');
});

await journey('Import check blocks Open registration', async (pages) => {
  // Three issues: two guests the guest page cannot tell apart, one with no contact, one unknown industry.
  const C = await journeyEvent('Check Gala', [
    ['C1', 'Rosa', 'Lopez', 'Acme', 'Banking', '', '0917 555 1234', 'regular', ''],
    ['C2', 'Ramon', 'Lopez', 'Acme', 'Banking', '', '0918 555 1234', 'regular', ''],
    ['C3', 'Nina', 'Nocontact', 'Acme', 'Banking', '', '', 'regular', ''],
    ['C4', 'Ivan', 'Elsewhere', 'Acme', 'Shipping', 'c4@example.com', '0917 555 9999', 'regular', ''],
  ], { ack: false, open: false });
  const p = await signIn('eventlead.demo');
  pages.push(p);
  await p.goto(`${BASE}/#/customapp/setup?e=${C.id}`);
  await p.waitForSelector('#ca-issues');
  const issues = await textOf(p, '#ca-issues');
  for (const s of ['3 issues to resolve', 'Same surname and last 4 digits (1)', 'No mobile and no email (1)', 'Industry not in the event\'s list (1)']) if (!issues.includes(s)) throw new Error(`Import check lacks "${s}": ${issues.slice(0, 200)}`);
  if (!(await p.locator('#ca-issues [data-fix="email"]').count()) || !(await p.locator('#ca-issues [data-fix="desk"]').count())) throw new Error('No fix actions.');
  await p.goto(`${BASE}/#/customapp/control?e=${C.id}`);
  await p.waitForSelector('[data-flag="registrationOpen"]');
  if (!(await p.isDisabled('[data-flag="registrationOpen"]')) || !/3 issues to resolve/.test(await textOf(p, '.ca-flags'))) throw new Error('Self check-in is not blocked by the import check.');
  // Fix one (desk only), then acknowledge the rest.
  await p.goto(`${BASE}/#/customapp/setup?e=${C.id}`);
  await p.click(`#ca-issues [data-fix="desk"][data-g="${C.g('C3').id}"]`);
  await p.waitForFunction(() => /2 issues to resolve/.test(document.querySelector('#ca-issues').textContent), null, { timeout: 5000 });
  await p.click('#ca-ack');
  await p.click('.modal button[type=submit]');
  await p.waitForTimeout(800);
  await p.goto(`${BASE}/#/customapp/control?e=${C.id}`);
  await p.waitForSelector('[data-flag="registrationOpen"]');
  if (await p.isDisabled('[data-flag="registrationOpen"]')) throw new Error('Self check-in stays blocked after the acknowledgement.');
});

// ----- CUSTOM APP (0.73, Tier 2): groups, walk-ins and substitutes, email cut, Event control -----
const evRow = (ref, first, last, owner, extra = {}) => [ref, first, last, extra.company || 'Isla Savings', extra.industry || 'Banking', extra.email ?? `${ref.toLowerCase()}@example.com`, extra.mobile || `0917 66${String(ref.charCodeAt(0)).padStart(2, '0')} ${String(1000 + Number(ref.slice(1) || 0))}`, extra.cls || 'regular', owner];
const guestOf = async (E, ref) => (await lead('GET', `${E.base}/guests?limit=300`)).guests.find((x) => x.externalKey === ref || x.ref === ref);
// Choose a table on the room plan (scrolled to the middle of the screen, clear of the sticky bars).
async function pickTable(page, tableId) {
  const n = page.locator(`[data-plan] [data-table="${tableId}"] .ca-t-num`);
  await n.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await n.click();
  await page.waitForFunction((id) => document.querySelector(`[data-plan] [data-table="${id}"]`)?.classList.contains('sel'), tableId, { timeout: 4000 });
}

await journey('Event groups: Seat together, Split group, Send group to Super Administrator', async (pages) => {
  const G = await journeyEvent('Group Gala', [
    ...['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'].map((r, i) => evRow(r, `Ana${i}`, `Grupo${i}`, 'event.demo')),
    evRow('M1', 'Mara', 'Otro', 'maria.staff'),
  ]);
  for (const r of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'M1']) await G.cmd(lead, { type: 'checkIn', guestId: G.g(r).id });
  // Event Demo Staff's tables: 3 and 4 hold 2, table 5 holds 10.
  for (const n of [3, 4]) await G.cmd(lead, { type: 'table.update', tableId: G.t(n).id, capacity: 2 });
  const p = await signIn('event.demo', DEMO_PW, PHONE);
  pages.push(p);
  await p.goto(`${BASE}/#/customapp/queue?e=${G.id}`);
  await p.waitForSelector('[data-pick]');
  for (const r of ['A1', 'A2', 'A3']) await p.check(`[data-pick="${G.g(r).id}"]`);
  await p.waitForSelector('[data-groupbar]:not([hidden])');
  if (!/3 guests selected/.test(await textOf(p, '[data-groupbar]'))) throw new Error(`Group bar: ${await textOf(p, '[data-groupbar]')}`);
  await p.click('[data-seat-group]');
  await p.waitForSelector('.ca-group-body [data-gt]');
  // Only tables with room for all three: table 5 (3 and 4 hold 2).
  const offered = await p.$$eval('.ca-group-body [data-gt] .ca-tno', (els) => els.map((e) => e.textContent.trim()));
  if (offered.join() !== 'Table 5') throw new Error(`Offered for a group of 3: ${offered}`);
  if (!(await textOf(p, '.ca-group-body')).includes('Tables with 3 free chairs together')) throw new Error('The group sheet does not say why these tables.');
  await p.click('.ca-group-body [data-gt]');
  await p.click('[data-seat-together]');
  await p.waitForTimeout(900);
  await noErrorToast(p, 'Seat together');
  const seated = await Promise.all(['A1', 'A2', 'A3'].map((r) => guestOf(G, r)));
  if (!seated.every((g) => g.seat?.number === 5)) throw new Error(`Not seated together: ${JSON.stringify(seated.map((g) => g.seat))}`);
  // Now table 5 holds 4 (one free), 3 and 4 hold 2 each: a group of three cannot sit together.
  await G.cmd(lead, { type: 'table.update', tableId: G.t(5).id, capacity: 4 });
  await go(p, `/customapp/queue?e=${G.id}`);
  await p.waitForSelector(`[data-pick="${G.g('A4').id}"]`);
  for (const r of ['A4', 'A5', 'A6']) await p.check(`[data-pick="${G.g(r).id}"]`);
  await p.click('[data-seat-group]');
  await p.waitForSelector('[data-split]');
  if (await p.locator('.ca-group-body [data-gt]').count()) throw new Error('A table that cannot take all three was offered.');
  const splitText = await textOf(p, '.ca-split');
  if (!/Table 3: 2 guests · Table 4: 1 guest/.test(splitText)) throw new Error(`Split suggestion: ${splitText}`);
  await p.click('[data-split]');
  await p.waitForSelector('.modal-backdrop:last-child .modal');
  const confirm = await textOf(p, '.modal-backdrop:last-child .modal');
  if (!/Split group/.test(confirm) || !/will not all sit together/.test(confirm)) throw new Error(`Split confirm: ${confirm}`);
  await p.click('.modal-backdrop:last-child button[type=submit]');
  await p.waitForTimeout(1000);
  await noErrorToast(p, 'Split group');
  const split = await Promise.all(['A4', 'A5', 'A6'].map((r) => guestOf(G, r)));
  if (split.map((g) => g.seat?.number).join() !== '3,3,4') throw new Error(`Split: ${split.map((g) => g.seat?.number)}`);
  // A group with guests of two owners: only the Super Administrator seats it.
  await go(p, `/customapp/find?e=${G.id}&status=waiting`);
  await p.waitForSelector(`[data-pick="${G.g('M1').id}"]`);
  await p.check(`[data-pick="${G.g('A7').id}"]`);
  await p.check(`[data-pick="${G.g('M1').id}"]`);
  await p.click('[data-seat-group]');
  await p.waitForSelector('[data-send-super]');
  if (await p.locator('.ca-group-body [data-gt]').count()) throw new Error('A mixed-owner group was offered tables.');
  await p.click('[data-send-super]');
  await p.waitForTimeout(800);
  await noErrorToast(p, 'Send group to Super Administrator');
  const inbox = (await lead('GET', `${G.base}/exceptions`)).items;
  if (!inbox.some((i) => i.kind === 'group' && i.guestIds.length === 2)) throw new Error('The group is not in the Super Administrator\'s inbox.');
  if (await p.evaluate(() => document.documentElement.scrollWidth) > 391) throw new Error('Wider than the phone.');
});

await journey('Event walk-in and substitute reach the Super Administrator\'s inbox', async (pages) => {
  const W = await journeyEvent('Walk-in Gala', [evRow('P1', 'Pedro', 'Reyes', 'event.demo', { cls: 'preferred' })]);
  await W.cmd(lead, { type: 'reserve', guestId: W.g('P1').id, tableId: W.t(1).id, seatNo: 4, reason: 'Preferred' });
  const p = await signIn('event.demo', DEMO_PW, PHONE);
  pages.push(p);
  await p.goto(`${BASE}/#/customapp/find?e=${W.id}`);
  await p.waitForSelector('[data-walkin]');
  await p.click('[data-walkin]');
  await p.fill('.modal input[name=first]', 'Lena');
  await p.fill('.modal input[name=last]', 'Walker');
  await p.fill('.modal input[name=company]', 'Northbay Bank');
  await p.fill('.modal input[name=note]', 'Says she was invited by Mr. Reyes');
  await submitModal(p, 'Add walk-in');
  // Record substitute on the invitee's sheet.
  await p.fill('#ca-q', 'Reyes');
  await p.waitForSelector(`[data-guest="${W.g('P1').id}"]`);
  await p.click(`[data-guest="${W.g('P1').id}"]`);
  await p.waitForSelector('[data-substitute]');
  await p.click('[data-substitute]');
  await p.fill('.modal-backdrop:last-child input[name=first]', 'Juan');
  await p.fill('.modal-backdrop:last-child input[name=last]', 'Reyes');
  await p.fill('.modal-backdrop:last-child input[name=note]', 'Pedro is unwell');
  await p.click('.modal-backdrop:last-child button[type=submit]');
  await p.waitForTimeout(800);
  await noErrorToast(p, 'Record substitute');
  // The Super Administrator's inbox has both; the substitute is one seat changing hands.
  const d = await signIn('eventlead.demo');
  pages.push(d);
  await d.goto(`${BASE}/#/customapp/control?e=${W.id}`);
  await d.waitForSelector('.ca-inbox-item');
  const inbox = await textOf(d, '[data-inbox]');
  for (const s of ['Walk-in: Lena Walker, Northbay Bank', 'Seat 1-4: Juan Reyes replaces Pedro Reyes']) if (!inbox.includes(s)) throw new Error(`Inbox lacks "${s}": ${inbox.slice(0, 300)}`);
  if (!/Needs approval\s*2/.test(await textOf(d, '[data-counts]'))) throw new Error(`Counts: ${await textOf(d, '[data-counts]')}`);
  // Approve the substitute from the inbox: the seat changes hands.
  await d.click('.ca-k-substitute [data-ia="approve"]');
  await submitModal(d, 'Approve substitute');
  const juan = (await lead('GET', `${W.base}/guests?q=Juan&limit=5`)).guests.find((g) => g.displayName === 'Juan Reyes');
  if (!(juan?.seat?.number === 1 && juan.seat.seatNo === 4)) throw new Error(`Juan's seat: ${JSON.stringify(juan?.seat)}`);
  if ((await guestOf(W, 'P1')).seat) throw new Error('Pedro still holds a seat.');
  await d.waitForFunction(() => !document.querySelector('.ca-k-substitute'), null, { timeout: 6000 });
});

await journey('Event email cut: Screenshot this screen, and no email parts for staff', async (pages) => {
  const E = await journeyEvent('Mail Gala', [evRow('E1', 'Elena', 'Correo', 'event.demo')]);
  const ph = await guestPhone();
  pages.push(ph);
  await ph.goto(`${BASE}/event/${E.code}`);
  await typeVerify(ph, 'Correo', '1001');
  await E.cmd(staffA, { type: 'assign', guestId: E.g('E1').id, tableId: E.t(3).id, seatNo: 2 });
  await ph.waitForSelector('#table-no', { timeout: 15000 });
  const line = (await textOf(ph, '#mail-line')).trim();
  if (line !== 'Screenshot this screen to show the usher.') throw new Error(`Guest page with email paused: "${line}"`);
  if (/emailed/i.test(await textOf(ph, '#box'))) throw new Error('The guest page mentions email while email is cut.');
  const s = await signIn('event.demo', DEMO_PW, PHONE);
  pages.push(s);
  await s.goto(`${BASE}/#/customapp/find?e=${E.id}&guest=${E.g('E1').id}`);
  await s.waitForSelector('.ca-sheet [data-email-line]');
  if (await s.locator('.ca-sheet [data-resend]').count()) throw new Error('Resend is shown while email is cut.');
  if (!/Email is paused: tell Elena their table/.test(await textOf(s, '.ca-sheet [data-email-line]'))) throw new Error(`Sheet: ${await textOf(s, '.ca-sheet [data-email-line]')}`);
  // Email on again (with the event's own address): the staff email parts are back.
  const ev = await lead('GET', E.base);
  await lead('PATCH', E.base, { rev: ev.rev, settings: { emailFrom: 'mail.gala@example.com' } });
  await E.cmd(lead, { type: 'setFlag', flag: 'emailPaused', value: false });
  await s.reload();
  await s.waitForSelector('.ca-sheet [data-email-line]');
  if (/Email is paused/.test(await textOf(s, '.ca-sheet [data-email-line]'))) throw new Error('The sheet still says email is paused.');
});

await journey('Event control: tables, workload moves, confirms, transfer, swap and release on every device', async (pages) => {
  const C = await journeyEvent('Control Gala', [
    evRow('P1', 'Pia', 'Santos', 'event.demo', { cls: 'preferred' }),
    ...['S1', 'S2', 'S3', 'S4'].map((r, i) => evRow(r, `Sam${i}`, `Seated${i}`, 'event.demo')),
    ...['Q1', 'Q2'].map((r, i) => evRow(r, `Wait${i}`, `Queue${i}`, 'event.demo')),
  ]);
  await C.cmd(lead, { type: 'reserve', guestId: C.g('P1').id, tableId: C.t(1).id, seatNo: 4, reason: 'Preferred' });
  await C.cmd(lead, { type: 'table.update', tableId: C.t(3).id, capacity: 2 });
  for (const [i, r] of ['S1', 'S2', 'S3', 'S4'].entries()) {
    await C.cmd(lead, { type: 'checkIn', guestId: C.g(r).id });
    await C.cmd(lead, { type: 'assign', guestId: C.g(r).id, tableId: C.t(i < 2 ? 3 : 4).id, seatNo: (i % 2) + 1 });
  }
  for (const r of ['Q1', 'Q2']) await C.cmd(lead, { type: 'checkIn', guestId: C.g(r).id });
  const d = await signIn('eventlead.demo');
  pages.push(d);
  await d.goto(`${BASE}/#/customapp/control?e=${C.id}`);
  await d.waitForSelector('[data-plan] .ca-tbl');
  await d.waitForSelector('.ca-work');
  // Every table on the plan with its number and count; a full table is dimmed and says FULL.
  if ((await d.locator('[data-plan] .ca-tbl').count()) !== 25) throw new Error('Not 25 tables on the plan.');
  if (!(await d.locator(`[data-plan] .ca-tbl.full[data-table="${C.t(3).id}"] .ca-t-count`).textContent()).includes('FULL')) throw new Error('Table 3 does not say FULL.');
  await d.click('.ca-tables-card summary');
  const t3row = d.locator('.ca-tables-card tr', { hasText: /^3/ }).first();
  const rowText = await t3row.textContent();
  if (!/Regular/.test(rowText) || !/2 of 2/.test(rowText) || !/Demo Event Staff|Event Staff/.test(rowText)) throw new Error(`Table 3's row: ${rowText}`);
  // Removing a table that has guests is disabled, with Move guests….
  if (!(await d.isDisabled(`[data-off="${C.t(3).id}"]`)) || !(await d.locator(`[data-move-guests="${C.t(3).id}"]`).count())) throw new Error('Table 3 with guests can be taken out of use, or has no Move guests….');
  // The workload: staffer, waiting, longest wait, last active; One by one moves a guest and a table.
  const head = await textOf(d, '.ca-work thead');
  for (const h of ['Staff', 'Waiting', 'Longest wait', 'Last active']) if (!head.includes(h)) throw new Error(`Workload lacks "${h}".`);
  await d.click(`[data-one-by-one="${aId}"]`);
  await d.waitForSelector(`.modal [data-mg="${C.g('Q1').id}"]`);
  await d.selectOption(`.modal [data-mg="${C.g('Q1').id}"]`, mariaId);
  await d.waitForTimeout(700);
  await d.selectOption(`.modal [data-mt="${C.t(5).id}"]`, mariaId);
  await d.waitForTimeout(700);
  await noErrorToast(d, 'One by one');
  await d.click('.modal [data-close] >> nth=0');
  if ((await guestOf(C, 'Q1')).ownerUserId !== mariaId) throw new Error('Q1 was not moved to Maria.');
  if ((await lead('GET', C.base)).tables.find((t) => t.number === 5).ownerUserId !== mariaId) throw new Error('Table 5 was not moved to Maria.');
  // A switch's confirm names its effect.
  await d.click('[data-flag="registrationOpen"]');
  await d.waitForSelector('.modal-backdrop:last-child .modal');
  const flagText = await textOf(d, '.modal-backdrop:last-child .modal');
  if (!flagText.includes('Turn off self check-in? Guests will be sent to the desk.')) throw new Error(`Flag confirm: ${flagText}`);
  await d.click('.modal-backdrop:last-child [data-close] >> nth=0');
  // A second device: Event Demo Staff's room plan.
  const s = await signIn('event.demo');
  pages.push(s);
  await s.goto(`${BASE}/#/customapp/room?e=${C.id}`);
  await s.waitForSelector('[data-plan] .ca-tbl');
  const countOn = (page, n) => page.$eval(`[data-plan] [data-table="${C.t(n).id}"] .ca-t-count`, (e) => e.textContent);
  // Transfer from Event control: S3 (table 4, chair 1) to table 6, chair 2; the other device shows it.
  await pickTable(d, C.t(4).id);
  await d.waitForSelector('.ca-dial');
  await d.click('.ca-dial [data-dchair="1"]');
  await d.click('[data-act="move"]');
  await pickTable(d, C.t(6).id);
  await d.waitForSelector('.ca-tview-head');
  await d.click('.ca-dial [data-dchair="2"]');
  await d.click('[data-act="move-here"]');
  await d.waitForTimeout(900);
  await noErrorToast(d, 'Transfer');
  if ((await guestOf(C, 'S3')).seat?.number !== 6) throw new Error('S3 was not moved to table 6.');
  await s.waitForFunction(([sel]) => document.querySelector(sel)?.textContent === '1/10', [`[data-plan] [data-table="${C.t(6).id}"] .ca-t-count`], { timeout: 8000 });
  if ((await countOn(s, 4)) !== '1/10') throw new Error(`Table 4 on the other device: ${await countOn(s, 4)}`);
  // Swap: S1 (table 3, chair 1) and S4 (table 4, chair 2).
  await pickTable(d, C.t(3).id);
  await d.waitForSelector('.ca-dial');
  await d.click('.ca-dial [data-dchair="1"]');
  await d.click('[data-act="move"]');
  await pickTable(d, C.t(4).id);
  await d.waitForFunction(() => /Table 4/.test(document.querySelector('.ca-tview-head')?.textContent || ''));
  await d.click('.ca-dial [data-dchair="2"]');
  await d.click('[data-act="swap"]');
  await d.waitForTimeout(900);
  await noErrorToast(d, 'Swap');
  const [s1, s4] = [await guestOf(C, 'S1'), await guestOf(C, 'S4')];
  if (!(s1.seat.number === 4 && s1.seat.seatNo === 2 && s4.seat.number === 3 && s4.seat.seatNo === 1)) throw new Error(`Swap: ${JSON.stringify([s1.seat, s4.seat])}`);
  // Release: the confirm names the guest, the table and the chair; every device sees the chair free.
  await pickTable(d, C.t(1).id);
  await d.waitForSelector('.ca-dial');
  await d.click('.ca-dial [data-dchair="4"]');
  await d.click('[data-act="release"]');
  await d.waitForSelector('.modal-backdrop:last-child input[name=reason]');
  const rel = await textOf(d, '.modal-backdrop:last-child .modal');
  if (!/Release table 1, chair 4, reserved for Pia Santos/.test(rel)) throw new Error(`Release confirm: ${rel}`);
  await d.fill('.modal-backdrop:last-child input[name=reason]', 'No-show');
  await d.click('.modal-backdrop:last-child button[type=submit]');
  await d.waitForTimeout(900);
  await noErrorToast(d, 'Release');
  await s.waitForFunction(([sel]) => document.querySelector(sel)?.textContent === '0/10', [`[data-plan] [data-table="${C.t(1).id}"] .ca-t-count`], { timeout: 8000 });
  // The counts on Event control follow on their next poll.
  await d.waitForFunction(() => /Seats left\s*\d+ of \d+/.test(document.querySelector('[data-counts]')?.textContent || ''), null, { timeout: 5000 });
});

// 6. Every page in every role's menu at phone width
const ROLES = [['employee.demo'], ['hr.demo'], ['payroll.demo'], ['it.demo'], ['sales.demo'], ['pm.demo'], ['eventlead.demo'], ['event.demo'], [ADMIN.username, ADMIN.password]];
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
      // Against the phone's own width: a phone browser widens its layout to fit a page that is too
      // wide (and zooms out), so innerWidth itself grows with the page (0.47).
      const over = await p.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, p.viewportSize().width);
      if (over > 1) wide.push(`${h} (${over}px wider)`);
      await noErrorToast(p, h);
    }
    if (wide.length) throw new Error(`Wider than a 390px phone: ${wide.join(', ')}`);
  });
}

await browser.close();
// The server saves its last minute on the way out (data/monitor.json): remove its folder after it exits.
await new Promise((resolve) => {
  server.once('exit', resolve);
  server.kill();
});
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {}
for (const p of passed) console.log(`  ok  ${p}`);
for (const f of failures) console.log(`  FAILED  ${f}`);
console.log(`\n${passed.length} passed, ${failures.length} failed.`);
process.exit(failures.length ? 1 : 0);
