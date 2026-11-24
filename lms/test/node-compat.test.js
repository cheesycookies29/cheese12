// ATLAS runs on Node 18 and later (package.json "engines"): servers set up before Node 22 keep
// Ubuntu 24.04's Node 18, and their automatic update refuses a version whose tests fail there. So
// the server code and the tests must not call what Node 18 does not have, unless they check for it
// first (as server/zip.js does for zlib.crc32). Found in November 2026: a test called zlib.crc32
// (Node 20.15 / 22.2 on) and the servers stopped installing updates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEWER = [
  [/\bzlib\.crc32\(/, 'zlib.crc32 (Node 20.15 / 22.2): use crc32 from server/zip.js'],
  [/\bPromise\.withResolvers\(/, 'Promise.withResolvers (Node 22)'],
  [/\b(Object|Map)\.groupBy\(/, 'Object.groupBy / Map.groupBy (Node 21)'],
  [/\.(toSorted|toReversed|toSpliced)\(/, 'toSorted / toReversed / toSpliced (Node 20)'],
  [/\bimport\.meta\.(dirname|filename)\b/, 'import.meta.dirname / filename (Node 20.11)'],
  [/\bArray\.fromAsync\(/, 'Array.fromAsync (Node 22)'],
  [/\bURL\.(canParse|parse)\(/, 'URL.canParse / URL.parse (Node 19.9 / 22.1)'],
  [/\bcrypto\.hash\(/, 'crypto.hash (Node 21.7)'],
  [/\bprocess\.getBuiltinModule\(/, 'process.getBuiltinModule (Node 22.3)'],
  [/\.(isWellFormed|toWellFormed)\(/, 'isWellFormed / toWellFormed (Node 20)'],
  [/\bfs\.globSync\(|\bglobSync\(/, 'fs.globSync (Node 22)'],
  [/\.(union|intersection|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(new Set/, 'Set methods (Node 22)'],
];
// The browser's code (public/) is not run by Node.
const DIRS = ['server', 'shared', 'test', 'scripts'];
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? (e.name === 'fixtures' ? [] : files(p)) : /\.(m?js)$/.test(e.name) ? [p] : [];
});

test('the server and the tests use only what Node 18 has (or check for it first)', () => {
  const found = [];
  for (const f of [...DIRS.flatMap((d) => files(path.join(ROOT, d))), path.join(ROOT, 'server.js')]) {
    if (f === fileURLToPath(import.meta.url)) continue;
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line) || /typeof\s+[\w.]+\s*===\s*'function'/.test(line)) return; // comments; guarded calls
      for (const [re, what] of NEWER) if (re.test(line)) found.push(`${path.relative(ROOT, f)}:${i + 1}: ${what}`);
    });
  }
  assert.deepEqual(found, [], `Not in Node 18, which servers set up before Node 22 run:\n${found.join('\n')}`);
});
