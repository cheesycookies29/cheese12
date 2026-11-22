// Data replication (0.48): on the IT Asset Management roadmap, a side-menu item tagged Soon with
// its own page, open to those who see the module; nothing behind it copies data yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const assets = fs.readFileSync(new URL('../public/js/views/assets.js', import.meta.url), 'utf8');

test('Data replication is in the IT Asset Management menu, tagged as coming soon, with its page', () => {
  const nav = app.slice(app.indexOf('  assets: ['), app.indexOf('  helpdesk: ['));
  assert.match(nav, /\{ href: '\/assets\/replication', label: 'Data replication', icon: 'database', permission: 'assets.view', soon: 'replication' \}/, 'soon: its id on the roadmap, so an administrator can hide it (0.63)');
  assert.ok(nav.indexOf('Data replication') < nav.indexOf("heading: 'My account'"), 'with the module pages, before My account');
  assert.match(app, /\['\/assets\/replication', replicationView, 'assets\.view', 'assets'\]/);
  assert.match(app, /n\.soon \? html`<span class="nav-soon">Soon<\/span>`/);
  assert.match(assets, /export async function replicationView/);
  assert.match(assets, /Coming soon/);
  assert.doesNotMatch(assets.slice(assets.indexOf('export async function replicationView')), /api\.(get|post|put|delete)/, 'no server calls: nothing to set up yet');
});
