// The style sheets parse (0.69.2): every { has its }. A stray } at the top level makes the browser
// drop the rule after it without a word (0.69.1 lost `main { min-width: 0 }` that way, so wide
// tables and boards stretched phone pages; the phone journeys caught it before it was deployed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../public/css/', import.meta.url);
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.css'))) {
  test(`${name}: braces balance, no stray }`, () => {
    const css = fs.readFileSync(new URL(name, dir), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
      .replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
    let depth = 0;
    let line = 1;
    for (const ch of css) {
      if (ch === '\n') line++;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        assert.ok(depth >= 0, `a } with nothing to close on line ${line}`);
      }
    }
    assert.equal(depth, 0, 'every { is closed');
  });
}
