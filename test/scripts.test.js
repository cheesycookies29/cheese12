import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { verifyPassword } from '../server/auth.js';

test('create-admin makes the first administrator once', () => {
  const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-')), 'db.json');
  const env = { ...process.env, DB_FILE };
  const out = execFileSync(process.execPath, ['scripts/create-admin.js', 'Owner', 'Ian', 'Roca'], { env, encoding: 'utf8' });
  const password = out.match(/Temporary password: (\S+)/)[1];
  const [user] = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')).users;
  assert.equal(user.username, 'owner');
  assert.equal(user.name, 'Ian Roca');
  assert.equal(user.role, 'admin');
  assert.equal(user.mustChangePassword, true);
  assert.ok(verifyPassword(password, user.passwordHash));
  const again = spawnSync(process.execPath, ['scripts/create-admin.js', 'second', 'Someone'], { env, encoding: 'utf8' });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already complete/);
});
