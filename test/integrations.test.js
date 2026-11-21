// Integrations on the CORE home (0.49): Microsoft 365, Google Cloud and CodeRabbit, all coming soon,
// in their own area under Your modules; none can be opened, pinned or turned on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { INTEGRATIONS, MODULES, PINNABLE, SWITCHABLE } from '../shared/modules.js';

test('the integrations are Microsoft 365, Google Cloud and CodeRabbit, all coming soon', () => {
  assert.deepEqual(INTEGRATIONS.map((i) => i.name), ['Microsoft 365', 'Google Cloud', 'CodeRabbit']);
  assert.ok(INTEGRATIONS.every((i) => i.status === 'soon' && i.description && i.tagline && i.glyph));
  assert.equal(new Set(INTEGRATIONS.map((i) => i.code)).size, INTEGRATIONS.length, 'codes are unique');
  for (const i of INTEGRATIONS) {
    assert.ok(!MODULES.some((m) => m.id === i.id), `${i.id} is not a module`);
    assert.ok(!PINNABLE.includes(i.id) && !SWITCHABLE.includes(i.id));
  }
  const icons = fs.readFileSync(new URL('../public/js/icons.js', import.meta.url), 'utf8');
  for (const i of INTEGRATIONS) assert.match(icons, new RegExp(`\\n  ${i.glyph}: '`), `icon ${i.glyph}`);
});

test('the CORE home shows them under Your modules, as cards or compact tiles, with nothing to open', () => {
  const home = fs.readFileSync(new URL('../public/js/views/launcher.js', import.meta.url), 'utf8');
  assert.match(home, /id="int-section"/);
  assert.ok(home.indexOf('id="sys-section"') < home.indexOf('id="int-section"'), 'below the modules');
  assert.match(home, /INTEGRATIONS\.map\(intCard\)/);
  assert.match(home, /INTEGRATIONS\.map\(intMini\)/);
  const cards = home.slice(home.indexOf('const intCard'), home.indexOf('const intMini') + 400);
  assert.doesNotMatch(cards, /<a |href=/, 'nothing to open yet');
  assert.match(fs.readFileSync(new URL('../public/js/modules.js', import.meta.url), 'utf8'), /INTEGRATIONS/);
});
