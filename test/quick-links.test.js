// Quick access (0.35): the pages each person pins (on the server, with their account) and the
// pages they opened last (in the browser). Only CORE's own pages, with a name of 1 to 80
// characters, at most 12, each once; only your own; kept through a backup and restore; never in
// the audit log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { cleanQuickLinks, validQuickHref, pageLabel, addRecent, readRecent, recentToShow, suggestedLinks, pinButton, QUICK_MAX, RECENT_KEEP, RECENT_SHOW } from '../shared/quick.js';
import { moduleAccess } from '../shared/profile.js';

const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-quick-')), 'db.json'));
const handle = createApi(db);
const client = () => {
  let cookie = '';
  return async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res.data;
  };
};
const fails = (promise, status, re) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, err.message);
  if (re) assert.match(err.message, re);
  return true;
});
const PW = 'Correct-Horse-42';
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
const emp = await admin('POST', '/api/employees', { employeeNo: 'E-1', firstName: 'Juan', lastName: 'Cruz', hireDate: '2020-01-01', payType: 'monthly', rate: 30000 });
async function account(username, role, name, extra = {}) {
  const u = await admin('POST', '/api/users', { name, username, role, password: PW, mustChangePassword: false, ...extra });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: PW });
  c.id = u.id;
  return c;
}
const juan = await account('juan', 'employee', 'Juan Cruz', { employeeId: emp.id });
const pia = await account('pia', 'pm', 'Pia Manager');
const link = (n) => ({ href: `#/projects/p${n}?tab=board`, label: `Project ${n}` });

test('only CORE pages, with a name of 1 to 80 characters, at most 12, as a list', () => {
  assert.ok(validQuickHref('#/me/requests'));
  assert.ok(validQuickHref('#/admin/monitor?tab=status&range=1h'));
  for (const bad of ['javascript:alert(1)', 'https://x', '#/x"><script>', '#/a b', '/me', '#me', '', null, 42, `#/${'a'.repeat(300)}`]) assert.equal(validQuickHref(bad), false, String(bad));
  assert.deepEqual(cleanQuickLinks([{ href: '#/me', label: '  My\tHome \n ' }]), [{ href: '#/me', label: 'My Home' }]);
  assert.throws(() => cleanQuickLinks({ href: '#/me', label: 'x' }), /as a list/);
  assert.throws(() => cleanQuickLinks('#/me'), /as a list/);
  assert.throws(() => cleanQuickLinks([{ href: 'javascript:alert(1)', label: 'x' }]), /page of CORE/);
  assert.throws(() => cleanQuickLinks([{ href: 'https://x', label: 'x' }]), /page of CORE/);
  assert.throws(() => cleanQuickLinks([{ href: '#/me', label: 'x'.repeat(81) }]), /1 to 80/);
  assert.throws(() => cleanQuickLinks([{ href: '#/me', label: ' \u0000 ' }]), /1 to 80/);
  assert.throws(() => cleanQuickLinks([{ href: '#/me', label: 5 }]), /needs a name/);
  assert.throws(() => cleanQuickLinks([null]), /address and a name/);
  assert.throws(() => cleanQuickLinks(Array.from({ length: 13 }, (_, i) => link(i))), /up to 12/);
  assert.equal(cleanQuickLinks(Array.from({ length: 12 }, (_, i) => link(i))).length, QUICK_MAX);
});

test('pinning: saved with the account, each page once, refused when wrong, cleared when empty', async () => {
  assert.deepEqual(await juan('GET', '/api/me/quick-links'), { links: [] });
  const saved = await juan('PUT', '/api/me/quick-links', { links: [{ href: '#/me/requests', label: 'HR · My Requests' }, { href: '#/helpdesk/mine', label: 'Service Desk · My tickets' }, { href: '#/me/requests', label: 'Again' }] });
  assert.deepEqual(saved.links.map((l) => l.label), ['HR · My Requests', 'Service Desk · My tickets'], 'the first of a repeated page is kept');
  assert.deepEqual(await juan('GET', '/api/me/quick-links'), saved);
  for (const [body, re] of [
    [{ links: [{ href: 'javascript:alert(1)', label: 'x' }] }, /page of CORE/],
    [{ links: [{ href: 'https://x', label: 'x' }] }, /page of CORE/],
    [{ links: [{ href: '#/me', label: 'x'.repeat(81) }] }, /1 to 80/],
    [{ links: Array.from({ length: 13 }, (_, i) => link(i)) }, /up to 12/],
    [{ links: 'nope' }, /as a list/],
    [{}, /as a list/],
  ]) await fails(juan('PUT', '/api/me/quick-links', body), 400, re);
  assert.equal((await juan('GET', '/api/me/quick-links')).links.length, 2, 'a refused change changes nothing');
  await fails(client()('GET', '/api/me/quick-links'), 401);
  await fails(client()('PUT', '/api/me/quick-links', { links: [] }), 401);
  // Empty: the field goes.
  await pia('PUT', '/api/me/quick-links', { links: [link(1)] });
  assert.ok(db.data.users.find((u) => u.username === 'pia').quickLinks);
  assert.deepEqual(await pia('PUT', '/api/me/quick-links', { links: [] }), { links: [] });
  assert.equal(Object.hasOwn(db.data.users.find((u) => u.username === 'pia'), 'quickLinks'), false);
});

test('your own only: nobody else reads them, not in the account lists, not in the audit log', async () => {
  await juan('PUT', '/api/me/quick-links', { links: [{ href: '#/me/requests', label: 'HR · My Requests' }] });
  await pia('PUT', '/api/me/quick-links', { links: [link(7)] });
  assert.deepEqual((await pia('GET', '/api/me/quick-links')).links, [link(7)]);
  assert.deepEqual((await juan('GET', '/api/me/quick-links')).links.map((l) => l.href), ['#/me/requests']);
  assert.deepEqual((await admin('GET', '/api/me/quick-links')).links, []);
  // The account as others (and the browser's status) see it carries no pinned pages.
  for (const u of await admin('GET', '/api/users')) assert.equal(u.quickLinks, undefined, u.username);
  assert.equal((await juan('GET', '/api/auth/status')).user.quickLinks, undefined);
  assert.equal(JSON.stringify(await pia('GET', `/api/people/${juan.id}`)).includes('My Requests'), false);
  const log = (await admin('GET', '/api/audit')).entries;
  assert.ok(!log.some((e) => /quick-links/.test(e.label || '')), 'a personal preference is not audited');
});

test('pinned pages survive a backup and restore; a backup with bad ones is refused', async () => {
  await juan('PUT', '/api/me/quick-links', { links: [{ href: '#/me/requests', label: 'HR · My Requests' }, { href: '#/profile', label: 'My profile' }] });
  const backup = structuredClone(await admin('GET', '/api/admin/export'));
  await juan('PUT', '/api/me/quick-links', { links: [] });
  await admin('POST', '/api/admin/import', { ...backup, password: PW });
  assert.deepEqual(db.data.users.find((u) => u.username === 'juan').quickLinks, [{ href: '#/me/requests', label: 'HR · My Requests' }, { href: '#/profile', label: 'My profile' }]);
  for (const bad of [[{ href: 'javascript:alert(1)', label: 'x' }], 'x', Array.from({ length: 13 }, (_, i) => link(i))]) {
    const b = structuredClone(backup);
    b.users.find((u) => u.username === 'juan').quickLinks = bad;
    await fails(admin('POST', '/api/admin/import', { ...b, password: PW }), 400, /pinned pages/);
  }
  assert.equal(db.data.users.find((u) => u.username === 'juan').quickLinks.length, 2, 'a refused restore changes nothing');
});

test('a page is named by its sidebar item and module, or by its heading', () => {
  assert.equal(pageLabel({ module: 'hr', navLabel: 'Leave & Requests' }), 'HR · Leave & Requests');
  assert.equal(pageLabel({ module: 'system', navLabel: 'Security monitor' }), 'Admin panel · Security monitor');
  assert.equal(pageLabel({ module: 'user', navLabel: 'Send feedback' }), 'Send feedback', 'your own pages have no module');
  assert.equal(pageLabel({ module: 'hr', navLabel: 'Employees', exact: false, heading: ' Juan  Dela Cruz ' }), 'HR · Juan Dela Cruz', 'a record: its heading');
  assert.equal(pageLabel({ module: 'user', heading: 'My profile' }), 'My profile');
  assert.equal(pageLabel({ module: 'hr', navLabel: 'Employees', exact: false }), 'HR · Employees');
  assert.equal(pageLabel({}), '');
  assert.equal(pageLabel({ module: 'projects', heading: 'x'.repeat(200) }).length, 80);
});

test('Recent: newest first, each page once, at most 12 kept and 6 shown, not pinned, not this page', () => {
  let list = [];
  for (let i = 0; i < 15; i++) list = addRecent(list, link(i));
  assert.equal(list.length, RECENT_KEEP);
  assert.equal(list[0].href, link(14).href);
  list = addRecent(list, link(10));
  assert.equal(list[0].href, link(10).href);
  assert.equal(list.filter((x) => x.href === link(10).href).length, 1);
  assert.deepEqual(addRecent(list, { href: 'javascript:alert(1)', label: 'x' }), list, 'a page that is not CORE is not kept');
  const shown = recentToShow(list, { pinned: [link(14)], current: link(13).href });
  assert.equal(shown.length, RECENT_SHOW);
  assert.ok(!shown.some((x) => x.href === link(14).href || x.href === link(13).href));
  assert.equal(shown[0].href, link(10).href);
  // What the browser kept is read back carefully.
  assert.deepEqual(readRecent('not json'), []);
  assert.deepEqual(readRecent('{"a":1}'), []);
  assert.deepEqual(readRecent(JSON.stringify([{ href: 'https://x', label: 'x' }, { href: '#/me', label: 'Home' }, { href: '#/me', label: 'Again' }])), [{ href: '#/me', label: 'Home' }]);
});

test('Suggested: the modules you can open (up to 5), My profile and My security', () => {
  const access = moduleAccess({ role: 'employee', employeeId: 'e1' }, { modules: { crm: false } });
  const links = suggestedLinks(access);
  const hrefs = links.map((l) => l.href);
  assert.ok(hrefs.includes('#/me'));
  assert.ok(!hrefs.includes('#/crm'), 'never a module you cannot open');
  assert.deepEqual(hrefs.slice(-2), ['#/profile', '#/account/security']);
  const all = suggestedLinks(moduleAccess({ role: 'admin' }, {}));
  assert.equal(all.length, 5 + 2);
});

test('the Pin this page button: off on the CORE home and when 12 are pinned; Unpin on a pinned page', () => {
  assert.equal(pinButton({ page: { href: '#/launcher', launcher: true } }).disabled, true);
  assert.deepEqual(pinButton({ page: { href: '#/me', label: 'HR · My Home' }, pinned: [] }), { action: 'pin', text: 'Pin this page', disabled: false, why: '' });
  assert.equal(pinButton({ page: { href: '#/me', label: 'x' }, pinned: [{ href: '#/me', label: 'x' }] }).text, 'Unpin this page');
  const full = Array.from({ length: 12 }, (_, i) => link(i));
  const b = pinButton({ page: { href: '#/me', label: 'x' }, pinned: full });
  assert.equal(b.disabled, true);
  assert.equal(b.why, 'You can pin up to 12 pages. Unpin one first.');
  assert.equal(pinButton({ page: { href: full[3].href, label: 'x' }, pinned: full }).action, 'unpin', 'a pinned page can always be unpinned');
});
